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

function cleanJockeyName(name) {
  return String(name || '')
    .replace(/^\([^)]+\)\s*/, '')
    .trim();
}

function parseRecordSeconds(rawTime, distance) {
  let t = Number(rawTime || 0);
  if (!t || t <= 0 || !distance) return null;
  if (t >= 300) t = t / 10;
  if (t >= 100) {
    const mins = Math.floor(t / 100);
    const secs = t - mins * 100;
    const totalSec = mins * 60 + secs;
    const speed = distance / totalSec;
    return speed >= 11 && speed <= 21 ? totalSec : null;
  }
  const speed = distance / t;
  return speed >= 11 && speed <= 21 ? t : null;
}

function getThisWeekendDates() {
  const now = new Date();
  const day = now.getDay();
  const diffToFri = 5 - day;
  const dates = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + diffToFri + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}${mm}${dd}`);
  }
  return dates;
}

async function fetchAllRows(table, orderCol = 'race_date') {
  let all = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderCol, { ascending: false })
      .range(from, from + step - 1);
    if (error || !data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

async function fetchUpcomingEntries(rcDate, meet = '1') {
  const url = `https://apis.data.go.kr/B551015/API26_2/entrySheet_2?ServiceKey=${KRA_KEY}&pageNo=1&numOfRows=500&meet=${meet}&rc_date=${rcDate}&_type=json`;
  const res = await fetch(url);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    const items = json?.response?.body?.items?.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch {
    return [];
  }
}

// 미세 튜닝된 정밀 스코어링 엔진 (경마장별 가중치 분리 + 슬럼프 감점 + 입상률 시너지)
function calculateTunedWinScore(horseStat, recentHistory, jockeyStat, distAvgSpeedMap, currentEntry, meetName) {
  const gateNo = Number(currentEntry.chulNo || currentEntry.gate_no || 8);
  const targetDist = Number(currentEntry.rcDist || currentEntry.distance || 0);
  const currentWeight = Number(currentEntry.wgBudam || currentEntry.weight || 0);
  const isJeju = meetName === '제주';

  // [1] 게이트 위치 유리함 (단거리 안쪽 게이트 강조, 최대 4점)
  const isSprint = targetDist > 0 && targetDist <= 1300;
  const gateBonus =
    gateNo <= 3 ? (isSprint ? 4 : 2.5) : gateNo <= 6 ? 2 : gateNo <= 9 ? 1 : 0;

  // [2] 기수 역량 (제주는 톱 기수 비중 강화 최대 16점, 서울/부경 최대 13점)
  let jockeyBonus = 4;
  let jockeyNote = '';
  if (jockeyStat && jockeyStat.total >= 15) {
    const jWinRate = jockeyStat.wins / jockeyStat.total;
    const jPlaceRate = jockeyStat.places / jockeyStat.total;
    const maxJ = isJeju ? 16 : 13;
    const mult = isJeju ? 52 : 44;
    jockeyBonus = Math.min(maxJ, Number((jWinRate * mult + jPlaceRate * 16).toFixed(1)));
    if (jWinRate >= 0.14) {
      jockeyNote = `기수 승률 ${(jWinRate * 100).toFixed(0)}%`;
    }
  }

  // DB 통계와 출전표 API 공식 통산 전적 통합
  const apiTotal = Number(currentEntry.rcCntT || 0);
  const apiWin = Number(currentEntry.ord1CntT || 0);
  const apiPlace = apiWin + Number(currentEntry.ord2CntT || 0) + Number(currentEntry.ord3CntT || 0);

  const validRecents = recentHistory.filter((r) => r.rank !== null);
  const totalRaces = Math.max(horseStat?.total_races || 0, apiTotal, validRecents.length);
  const winCount =
    apiTotal > 0 ? apiWin : validRecents.filter((r) => r.rank === 1).length;
  const placeCount =
    apiTotal > 0 ? apiPlace : validRecents.filter((r) => r.rank <= 3).length;

  // 순수 신예마 보수적 평가
  if (totalRaces === 0) {
    const rookieScore = Number((20 + jockeyBonus + gateBonus).toFixed(1));
    return {
      score: rookieScore,
      reason: ['첫 출주 신예마', jockeyNote, gateNo <= 4 ? `${gateNo}번 게이트` : null]
        .filter(Boolean)
        .join(' · '),
    };
  }

  // [3] 통산 승률 + 연대율 + 꾸준함 시너지 보너스 (최대 42점)
  const winRate = winCount / totalRaces;
  const placeRate = placeCount / totalRaces;
  const winScore = Math.min(24, winRate * 100 * 0.65);
  const placeScore = Math.min(14, placeRate * 100 * 0.25);
  const consistencyBonus = totalRaces >= 5 && placeRate >= 0.5 ? 4 : 0;

  // [4] 최근 3경주 가중 평균 폼 + 슬럼프 감점 (-6점 ~ +28점)
  let formScore = 8;
  let formNote = '';

  if (validRecents.length > 0) {
    const weights = [0.55, 0.28, 0.17];
    const last3 = validRecents.slice(0, 3);
    let weightedRankSum = 0;
    let weightTotal = 0;

    last3.forEach((r, idx) => {
      const w = weights[idx] || 0.17;
      weightedRankSum += Math.min(r.rank, 10) * w;
      weightTotal += w;
    });

    const wAvgRank = weightedRankSum / weightTotal;
    formScore = Math.max(0, 23 - (wAvgRank - 1) * 2.9);

    const last = last3[0];
    // 최근 3경주 연속 하위권(6위 이하) 슬럼프 페널티
    if (last3.length >= 3 && last3.every((r) => r.rank >= 6)) {
      formScore -= 6;
      formNote = `최근 부진(직전 ${last.rank}위)`;
    } else if (last.rank === 1) {
      formScore += 5;
      formNote = '직전 1위 우승';
    } else if (last.rank <= 3) {
      formScore += 2.5;
      formNote = `직전 ${last.rank}위 입상`;
    } else if (last3.length >= 2 && last.rank < last3[1].rank) {
      formScore += 1.2;
      formNote = `상승세(${last3[1].rank}→${last.rank}위)`;
    } else {
      formNote = `직전 ${last.rank}위`;
    }
  } else if (horseStat && horseStat.avg_rank > 0) {
    formScore = Math.max(0, 20 - (horseStat.avg_rank - 1) * 2.5);
  }

  // [5] 보정 주파 속도 지수 (서울/부경 비중 강화, 최대 13점)
  let speedScore = 5;
  let speedNote = '';
  const speedDiffs = [];
  for (const r of validRecents.slice(0, 3)) {
    const sec = parseRecordSeconds(r.record_time, r.distance);
    if (sec) {
      const horseSpeed = r.distance / sec;
      const avgSpeed = distAvgSpeedMap.get(`${r.meet}_${r.distance}`);
      if (avgSpeed) speedDiffs.push(horseSpeed - avgSpeed);
    }
  }
  if (speedDiffs.length > 0) {
    const avgDiff = speedDiffs.reduce((a, b) => a + b, 0) / speedDiffs.length;
    const maxS = isJeju ? 10 : 13;
    speedScore = Math.max(0, Math.min(maxS, maxS / 2 + avgDiff * 17));
    if (avgDiff >= 0.12) speedNote = '상위 스피드';
  }

  // [6] 동일 거리 입상 적성 & 부담중량 증감 (제주는 부담중량 민감도 상향)
  let distBonus = 0;
  let distNote = '';
  if (targetDist > 0 && validRecents.length > 0) {
    const sameDist = validRecents.filter(
      (r) => r.distance > 0 && Math.abs(r.distance - targetDist) <= 100
    );
    if (sameDist.some((r) => r.rank === 1)) {
      distBonus = 4;
      distNote = `${targetDist}m 우승적성`;
    } else if (sameDist.some((r) => r.rank <= 3)) {
      distBonus = 2.5;
      distNote = `${targetDist}m 입상적성`;
    }
  }

  let weightAdj = 0;
  let weightNote = '';
  if (currentWeight > 0 && validRecents.length > 0 && validRecents[0].weight > 0) {
    const diff = currentWeight - validRecents[0].weight;
    if (diff <= -1.5) {
      weightAdj = isJeju ? 3.5 : 2;
      weightNote = `감량(${diff.toFixed(1)}kg)`;
    } else if (diff >= 2.0) {
      weightAdj = isJeju ? -3 : -2;
    }
  }

  const totalScore = Number(
    Math.max(
      10,
      winScore +
        placeScore +
        consistencyBonus +
        formScore +
        speedScore +
        distBonus +
        jockeyBonus +
        gateBonus +
        weightAdj
    ).toFixed(1)
  );

  const reasons = [
    `승률 ${(winRate * 100).toFixed(0)}%(${winCount}/${totalRaces}전)`,
    `입상률 ${(placeRate * 100).toFixed(0)}%`,
    formNote,
    speedNote,
    distNote,
    weightNote,
    jockeyNote,
    gateNo <= 3 ? `${gateNo}번 게이트` : null,
  ].filter(Boolean);

  return {
    score: totalScore,
    reason: reasons.join(' · '),
  };
}

async function runPredictionAndBacktest() {
  console.log('미세 튜닝 엔진 실행 중 (24,304건 전수 데이터 기반)...');
  const targetDates = getThisWeekendDates();

  const [horsesData, allHistory] = await Promise.all([
    fetchAllRows('horses', 'horse_name'),
    fetchAllRows('race_history', 'race_date'),
  ]);

  const horseMap = new Map(horsesData.map((h) => [h.horse_name, h]));
  const historyMap = new Map();
  const jockeyStats = {};
  const speedBuckets = new Map();

  for (const row of allHistory) {
    if (!historyMap.has(row.horse_name)) historyMap.set(row.horse_name, []);
    historyMap.get(row.horse_name).push(row);

    const jk = cleanJockeyName(row.jockey_name);
    if (jk && row.rank !== null) {
      if (!jockeyStats[jk]) jockeyStats[jk] = { total: 0, wins: 0, places: 0 };
      jockeyStats[jk].total += 1;
      if (row.rank === 1) jockeyStats[jk].wins += 1;
      if (row.rank <= 3) jockeyStats[jk].places += 1;
    }

    const sec = parseRecordSeconds(row.record_time, row.distance);
    if (sec) {
      const sKey = `${row.meet}_${row.distance}`;
      if (!speedBuckets.has(sKey)) speedBuckets.set(sKey, { sum: 0, cnt: 0 });
      const b = speedBuckets.get(sKey);
      b.sum += row.distance / sec;
      b.cnt += 1;
    }
  }

  const distAvgSpeedMap = new Map();
  for (const [k, v] of speedBuckets.entries()) {
    distAvgSpeedMap.set(k, v.sum / v.cnt);
  }

  // 1. 이번 주 예정 경주 예측 계산
  const meets = [
    { code: '1', name: '서울' },
    { code: '3', name: '부산경남' },
    { code: '2', name: '제주' },
  ];

  const upcomingRows = [];
  for (const date of targetDates) {
    for (const meet of meets) {
      const entries = await fetchUpcomingEntries(date, meet.code);
      if (entries.length === 0) continue;

      for (const item of entries) {
        if (!item.hrName) continue;
        const rawHorseName = String(item.hrName).trim();
        const normalizedName = cleanHorseName(rawHorseName);
        const jkName = cleanJockeyName(item.jkName);

        const stat = horseMap.get(normalizedName);
        const recents = historyMap.get(normalizedName) || [];
        const { score, reason } = calculateTunedWinScore(
          stat,
          recents,
          jockeyStats[jkName],
          distAvgSpeedMap,
          item,
          meet.name
        );

        upcomingRows.push({
          race_date: date,
          meet: meet.name,
          race_no: Number(item.rcNo || 0),
          distance: Number(item.rcDist || 0),
          gate_no: Number(item.chulNo || 0),
          horse_name: rawHorseName,
          jockey_name: String(item.jkName || '').trim(),
          weight: Number(item.wgBudam || 0),
          ai_score: score,
          reason,
        });
      }
    }
  }

  if (upcomingRows.length > 0) {
    await supabase.from('upcoming_races').delete().neq('id', 0);
    for (let i = 0; i < upcomingRows.length; i += 100) {
      const chunk = upcomingRows.slice(i, i + 100);
      await supabase.from('upcoming_races').insert(chunk);
    }
    console.log(`이번 주 예정 경주 ${upcomingRows.length}두 미세 튜닝 저장 완료.`);
  }

  // 2. 최근 12개 경마일 백테스트 검증
  const uniqueDates = Array.from(new Set(allHistory.map((r) => r.race_date))).sort();
  const recentTestDates = uniqueDates.slice(-12);

  const raceGroups = new Map();
  for (const r of allHistory) {
    if (!recentTestDates.includes(r.race_date)) continue;
    const key = `${r.race_date}_${r.meet}_${r.race_no}`;
    if (!raceGroups.has(key)) raceGroups.set(key, []);
    raceGroups.get(key).push(r);
  }

  const logRows = [];
  for (const [, runners] of raceGroups.entries()) {
    if (runners.length < 5) continue;
    const raceDate = runners[0].race_date;
    const meetName = runners[0].meet;

    const scoredRunners = runners.map((runner) => {
      const priorRecords = (historyMap.get(runner.horse_name) || []).filter(
        (h) => h.race_date < raceDate && h.rank !== null
      );
      const priorStat =
        priorRecords.length > 0
          ? {
              total_races: priorRecords.length,
              win_count: priorRecords.filter((x) => x.rank === 1).length,
              place_count: priorRecords.filter((x) => x.rank <= 3).length,
              avg_rank:
                priorRecords.reduce((acc, x) => acc + x.rank, 0) / priorRecords.length,
            }
          : null;

      const jk = cleanJockeyName(runner.jockey_name);
      const { score, reason } = calculateTunedWinScore(
        priorStat,
        priorRecords,
        jockeyStats[jk],
        distAvgSpeedMap,
        runner,
        meetName
      );
      return { ...runner, ai_score: score, reason };
    });

    scoredRunners.sort((a, b) => b.ai_score - a.ai_score);
    const top3 = scoredRunners.slice(0, 3);

    top3.forEach((pick, idx) => {
      const actual = pick.rank;
      logRows.push({
        race_date: pick.race_date,
        meet: pick.meet,
        race_no: pick.race_no,
        distance: pick.distance,
        predicted_rank: idx + 1,
        gate_no: pick.gate_no,
        horse_name: pick.horse_name,
        jockey_name: pick.jockey_name,
        ai_score: pick.ai_score,
        reason: pick.reason,
        actual_rank: actual,
        is_win_hit: actual === 1,
        is_place_hit: actual !== null && actual <= 3,
      });
    });
  }

  if (logRows.length > 0) {
    await supabase.from('prediction_logs').delete().neq('id', 0);
    for (let i = 0; i < logRows.length; i += 100) {
      const chunk = logRows.slice(i, i + 100);
      const { error } = await supabase.from('prediction_logs').insert(chunk);
      if (error) console.error('prediction_logs 저장 오류:', error.message);
    }
    const top1Logs = logRows.filter((l) => l.predicted_rank === 1);
    const winHits = top1Logs.filter((l) => l.is_win_hit).length;
    const placeHits = top1Logs.filter((l) => l.is_place_hit).length;
    console.log(
      `미세 튜닝 백테스트 결과: 총 ${top1Logs.length}경주 중 1순위 단승 적중 ${winHits}회(${(
        (winHits / top1Logs.length) *
        100
      ).toFixed(1)}%), 연승(3위 내) 적중 ${placeHits}회(${(
        (placeHits / top1Logs.length) *
        100
      ).toFixed(1)}%)`
    );
  }
}

runPredictionAndBacktest();