import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()
);

const KRA_KEY = process.env.KRA_API_KEY!.trim();

function cleanHorseName(name: string) {
  return String(name || '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim();
}

function cleanJockeyName(name: string) {
  return String(name || '')
    .replace(/^\([^)]+\)\s*/, '')
    .trim();
}

function parseRank(ord: unknown) {
  const num = parseInt(String(ord || '').replace(/[^0-9]/g, ''), 10);
  if (!num || num <= 0 || num > 30) return null;
  return num;
}

function getUpcomingWeekendDates() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const diffToFri = day <= 5 ? 5 - day : 6;
  const dates: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(kst);
    d.setUTCDate(kst.getUTCDate() + diffToFri + i);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}${mm}${dd}`);
  }
  return dates;
}

async function fetchKRA(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    const text = await res.text();
    const json = JSON.parse(text);
    const items = json?.response?.body?.items?.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch {
    clearTimeout(timer);
    return null; // 해외 IP 차단 또는 타임아웃
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const keyParam = searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET;

  if (
    cronSecret &&
    authHeader !== `Bearer ${cronSecret}` &&
    keyParam !== cronSecret
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const meets = [
    { code: '1', name: '서울' },
    { code: '3', name: '부산경남' },
    { code: '2', name: '제주' },
  ];

  // 1. 최근 월 경주 성적 동기화 및 미채점 prediction_logs 자동 채점
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyymm = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;

  let newHistoryCount = 0;
  let gradedCount = 0;

  for (const meet of meets) {
    const url = `https://apis.data.go.kr/B551015/API214_1/RaceDetailResult_1?ServiceKey=${KRA_KEY}&pageNo=1&numOfRows=1000&meet=${meet.code}&rc_month=${yyyymm}&_type=json`;
    const items = await fetchKRA(url);
    if (!items) {
      return NextResponse.json({
        status: 'blocked_or_timeout',
        message: '해외 서버 IP 차단 또는 응답 지연으로 기존 DB 유지 (로컬 동기화 권장)',
      });
    }

    for (const item of items) {
      const hName = cleanHorseName(item.hrName);
      const rcDate = String(item.rcDate || '');
      const rcNo = Number(item.rcNo || 0);
      const rank = parseRank(item.ord);
      if (!hName || !rcDate || !rcNo) continue;

      const { error } = await supabase.from('race_history').upsert(
        {
          race_date: rcDate,
          meet: meet.name,
          race_no: rcNo,
          distance: Number(item.rcDist || 0),
          horse_name: hName,
          gate_no: Number(item.chulNo || 0),
          jockey_name: String(item.jkName || '').trim(),
          weight: Number(item.wgBudam || 0),
          rank,
          record_time: Number(item.rcTime || 0),
        },
        { onConflict: 'race_date,meet,race_no,horse_name' }
      );
      if (!error) newHistoryCount++;

      // 사후 검증 로그 채점
      if (rank !== null) {
        const { data: updated } = await supabase
          .from('prediction_logs')
          .update({
            actual_rank: rank,
            is_win_hit: rank === 1,
            is_place_hit: rank <= 3,
          })
          .eq('race_date', rcDate)
          .eq('meet', meet.name)
          .eq('race_no', rcNo)
          .eq('horse_name', hName)
          .is('actual_rank', null)
          .select('id');

        if (updated && updated.length > 0) gradedCount += updated.length;
      }
    }
  }

  // 2. 이번 주 예정 출전표 확인 및 갱신
  const targetDates = getUpcomingWeekendDates();
  let upcomingCount = 0;

  const { data: horsesData } = await supabase.from('horses').select('*');
  const horseMap = new Map((horsesData || []).map((h) => [h.horse_name, h]));

  const upcomingRows: any[] = [];
  for (const date of targetDates) {
    for (const meet of meets) {
      const url = `https://apis.data.go.kr/B551015/API26_2/entrySheet_2?ServiceKey=${KRA_KEY}&pageNo=1&numOfRows=500&meet=${meet.code}&rc_date=${date}&_type=json`;
      const entries = await fetchKRA(url);
      if (!entries || entries.length === 0) continue;

      for (const item of entries) {
        if (!item.hrName) continue;
        const rawHorseName = String(item.hrName).trim();
        const normName = cleanHorseName(rawHorseName);
        const stat = horseMap.get(normName);

        const apiTotal = Number(item.rcCntT || 0);
        const apiWin = Number(item.ord1CntT || 0);
        const apiPlace = apiWin + Number(item.ord2CntT || 0) + Number(item.ord3CntT || 0);
        const total = Math.max(stat?.total_races || 0, apiTotal);
        const winRate = total > 0 ? (apiTotal > 0 ? apiWin : stat?.win_count || 0) / total : 0;
        const placeRate = total > 0 ? (apiTotal > 0 ? apiPlace : stat?.place_count || 0) / total : 0;
        const gateNo = Number(item.chulNo || 8);

        const score =
          total === 0
            ? Number((25 + (gateNo <= 4 ? 3 : 0)).toFixed(1))
            : Number(
                (
                  Math.min(35, winRate * 75) +
                  Math.min(25, placeRate * 40) +
                  (stat?.avg_rank ? Math.max(0, 20 - (stat.avg_rank - 1) * 2.5) : 10) +
                  (gateNo <= 3 ? 4 : 1)
                ).toFixed(1)
              );

        upcomingRows.push({
          race_date: date,
          meet: meet.name,
          race_no: Number(item.rcNo || 0),
          distance: Number(item.rcDist || 0),
          gate_no: gateNo,
          horse_name: rawHorseName,
          jockey_name: String(item.jkName || '').trim(),
          weight: Number(item.wgBudam || 0),
          ai_score: score,
          reason:
            total === 0
              ? '첫 출주 신예마'
              : `승률 ${(winRate * 100).toFixed(0)}% · 입상률 ${(placeRate * 100).toFixed(0)}%`,
        });
      }
    }
  }

  if (upcomingRows.length > 0) {
    await supabase.from('upcoming_races').delete().neq('id', 0);
    for (let i = 0; i < upcomingRows.length; i += 100) {
      await supabase.from('upcoming_races').insert(upcomingRows.slice(i, i + 100));
    }
    upcomingCount = upcomingRows.length;

    // 경주별 상위 3두를 prediction_logs에 스냅샷 기록 (아직 없는 경우만)
    const grouped = new Map<string, any[]>();
    for (const r of upcomingRows) {
      const k = `${r.race_date}_${r.meet}_${r.race_no}`;
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(r);
    }

    for (const [, list] of grouped.entries()) {
      list.sort((a, b) => b.ai_score - a.ai_score);
      const top3 = list.slice(0, 3);
      for (let idx = 0; idx < top3.length; idx++) {
        const p = top3[idx];
        await supabase.from('prediction_logs').upsert(
          {
            race_date: p.race_date,
            meet: p.meet,
            race_no: p.race_no,
            distance: p.distance,
            predicted_rank: idx + 1,
            gate_no: p.gate_no,
            horse_name: cleanHorseName(p.horse_name),
            jockey_name: p.jockey_name,
            ai_score: p.ai_score,
            reason: p.reason,
          },
          { onConflict: 'race_date,meet,race_no,predicted_rank', ignoreDuplicates: true }
        );
      }
    }
  }

  return NextResponse.json({
    status: 'ok',
    newHistoryCount,
    gradedCount,
    upcomingCount,
  });
}