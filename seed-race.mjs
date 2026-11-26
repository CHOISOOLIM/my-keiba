import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
);

const KRA_KEY = process.env.KRA_API_KEY.trim();

function cleanHorseName(name) {
  return String(name || '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim();
}

function parseRank(ord) {
  const num = parseInt(String(ord || '').replace(/[^0-9]/g, ''), 10);
  if (!num || num <= 0 || num > 30) return null;
  return num;
}

async function fetchAllMonthResults(yyyymm, meet = '1') {
  let pageNo = 1;
  const numOfRows = 1000;
  let collected = [];

  while (true) {
    const url = `https://apis.data.go.kr/B551015/API214_1/RaceDetailResult_1?ServiceKey=${KRA_KEY}&pageNo=${pageNo}&numOfRows=${numOfRows}&meet=${meet}&rc_month=${yyyymm}&_type=json`;
    const res = await fetch(url);
    const text = await res.text();

    try {
      const json = JSON.parse(text);
      const body = json?.response?.body;
      const items = body?.items?.item;
      if (!items) break;

      const list = Array.isArray(items) ? items : [items];
      collected = collected.concat(list);

      const totalCount = Number(body?.totalCount || 0);
      if (collected.length >= totalCount || list.length < numOfRows) break;
      pageNo += 1;
    } catch {
      break;
    }
  }
  return collected;
}

async function runSeed() {
  console.log('한국마사회 2026년 전체(1~11월) 과거 경주 성적 수집 시작...');
  const months = [
    '202601', '202602', '202603', '202604', '202605', '202606',
    '202607', '202608', '202609', '202610', '202611'
  ];
  const meets = [
    { code: '1', name: '서울' },
    { code: '3', name: '부산경남' },
    { code: '2', name: '제주' },
  ];

  const recordMap = new Map();

  for (const m of months) {
    for (const meet of meets) {
      const items = await fetchAllMonthResults(m, meet.code);
      console.log(`수집 완료: ${m} ${meet.name} (${items.length}건)`);

      for (const item of items) {
        const hName = cleanHorseName(item.hrName);
        if (!hName || !item.rcDate) continue;

        const key = `${item.rcDate}_${meet.name}_${item.rcNo}_${hName}`;
        recordMap.set(key, {
          race_date: String(item.rcDate),
          meet: meet.name,
          race_no: Number(item.rcNo || 0),
          distance: Number(item.rcDist || 0),
          horse_name: hName,
          gate_no: Number(item.chulNo || 0),
          jockey_name: String(item.jkName || '').trim(),
          weight: Number(item.wgBudam || 0),
          rank: parseRank(item.ord),
          record_time: Number(item.rcTime || 0),
        });
      }
    }
  }

  const allRecords = Array.from(recordMap.values());
  console.log(`총 ${allRecords.length}건의 고유 경주 기록 확보. DB 저장 시작...`);

  await supabase.from('race_history').delete().neq('id', 0);

  for (let i = 0; i < allRecords.length; i += 250) {
    const chunk = allRecords.slice(i, i + 250);
    const { error } = await supabase.from('race_history').insert(chunk);
    if (error) console.error('race_history 저장 오류:', error.message);
  }

  const horseStats = {};
  for (const r of allRecords) {
    if (!horseStats[r.horse_name]) {
      horseStats[r.horse_name] = { total: 0, wins: 0, places: 0, rankSum: 0 };
    }
    if (r.rank !== null) {
      horseStats[r.horse_name].total += 1;
      if (r.rank === 1) horseStats[r.horse_name].wins += 1;
      if (r.rank <= 3) horseStats[r.horse_name].places += 1;
      horseStats[r.horse_name].rankSum += r.rank;
    }
  }

  const horseRows = Object.entries(horseStats)
    .filter(([, s]) => s.total > 0)
    .map(([name, s]) => ({
      horse_name: name,
      total_races: s.total,
      win_count: s.wins,
      place_count: s.places,
      avg_rank: Number((s.rankSum / s.total).toFixed(2)),
      updated_at: new Date().toISOString(),
    }));

  await supabase.from('horses').delete().neq('horse_name', '');

  for (let i = 0; i < horseRows.length; i += 250) {
    const chunk = horseRows.slice(i, i + 250);
    const { error } = await supabase.from('horses').insert(chunk);
    if (error) console.error('horses 저장 오류:', error.message);
  }

  console.log(`완료! 총 ${horseRows.length}마리의 연간 누적 통계 저장 완료.`);
}

runSeed();