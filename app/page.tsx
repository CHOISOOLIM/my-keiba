'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface UpcomingRaceRow {
  id: number;
  race_date: string;
  meet: string;
  race_no: number;
  distance: number;
  gate_no: number;
  horse_name: string;
  jockey_name: string;
  weight: number;
  ai_score: number;
  reason: string;
}

interface PredictionLogRow {
  id: number;
  race_date: string;
  meet: string;
  race_no: number;
  distance: number;
  predicted_rank: number;
  gate_no: number;
  horse_name: string;
  jockey_name: string;
  ai_score: number;
  reason: string;
  actual_rank: number | null;
  is_win_hit: boolean;
  is_place_hit: boolean;
}

function formatDateLabel(yyyymmdd: string) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dateObj = new Date(y, m - 1, d);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${m}/${d}(${days[dateObj.getDay()]})`;
}

// 추천 근거 텍스트를 가독성 높은 컬러 태그 칩으로 렌더링
function ReasonChips({ reason }: { reason: string }) {
  const parts = String(reason || '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {parts.map((tag, i) => {
        let style = 'bg-slate-800/90 text-slate-300 border-slate-700/70';
        if (tag.includes('1위 우승')) {
          style = 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold';
        } else if (tag.includes('입상') && !tag.startsWith('입상률')) {
          style = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
        } else if (tag.includes('스피드')) {
          style = 'bg-sky-500/15 text-sky-300 border-sky-500/30';
        } else if (tag.includes('적성')) {
          style = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
        } else if (tag.includes('감량')) {
          style = 'bg-teal-500/15 text-teal-300 border-teal-500/30';
        } else if (tag.includes('기수 승률')) {
          style = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
        }
        return (
          <span
            key={i}
            className={`px-1.5 py-0.5 rounded text-[10px] border leading-tight ${style}`}
          >
            {tag}
          </span>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'UPCOMING' | 'RESULTS'>('UPCOMING');
  const [rows, setRows] = useState<UpcomingRaceRow[]>([]);
  const [logs, setLogs] = useState<PredictionLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState<string>('ALL');
  const [selectedMeet, setSelectedMeet] = useState<string>('ALL');
  const [selectedLogDate, setSelectedLogDate] = useState<string>('ALL');
  const [expandedRaces, setExpandedRaces] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [upcomingRes, logsRes] = await Promise.all([
        supabase
          .from('upcoming_races')
          .select('*')
          .order('race_date', { ascending: true })
          .order('meet', { ascending: true })
          .order('race_no', { ascending: true })
          .order('ai_score', { ascending: false }),
        supabase
          .from('prediction_logs')
          .select('*')
          .not('actual_rank', 'is', null) // 실제 경주 결과가 확정된 데이터만 검증표에 로드
          .order('race_date', { ascending: false })
          .order('meet', { ascending: true })
          .order('race_no', { ascending: true })
          .order('predicted_rank', { ascending: true }),
      ]);

      if (!upcomingRes.error && upcomingRes.data) {
        setRows(upcomingRes.data);
        const dates = Array.from(new Set(upcomingRes.data.map((r) => r.race_date)));
        if (dates.length > 0) setSelectedDate(dates[0]);
      }

      if (!logsRes.error && logsRes.data) {
        setLogs(logsRes.data);
        const lDates = Array.from(new Set(logsRes.data.map((r) => r.race_date)));
        if (lDates.length > 0) setSelectedLogDate(lDates[0]);
      }

      setLoading(false);
    }
    loadData();
  }, []);

  // 적중률 KPI 집계
  const kpiStats = useMemo(() => {
    const top1 = logs.filter((l) => l.predicted_rank === 1 && l.actual_rank !== null);
    const totalRaces = top1.length;
    const winHits = top1.filter((l) => l.is_win_hit).length;
    const placeHits = top1.filter((l) => l.is_place_hit).length;

    const raceMap = new Map<string, PredictionLogRow[]>();
    for (const l of logs) {
      const k = `${l.race_date}-${l.meet}-${l.race_no}`;
      if (!raceMap.has(k)) raceMap.set(k, []);
      raceMap.get(k)!.push(l);
    }
    let top3WinRaces = 0;
    for (const picks of raceMap.values()) {
      if (picks.some((p) => p.actual_rank === 1)) top3WinRaces += 1;
    }

    return {
      totalRaces,
      winHits,
      winRate: totalRaces > 0 ? ((winHits / totalRaces) * 100).toFixed(1) : '0.0',
      placeHits,
      placeRate: totalRaces > 0 ? ((placeHits / totalRaces) * 100).toFixed(1) : '0.0',
      top3WinRate: raceMap.size > 0 ? ((top3WinRaces / raceMap.size) * 100).toFixed(1) : '0.0',
    };
  }, [logs]);

  const dates = useMemo(
    () => Array.from(new Set(rows.map((r) => r.race_date))).sort(),
    [rows]
  );

  const logDates = useMemo(
    () => Array.from(new Set(logs.map((r) => r.race_date))).sort().reverse(),
    [logs]
  );

  const meets = ['ALL', '서울', '부산경남', '제주'];

  // 예정 경주 그룹화
  const groupedRaces = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (selectedDate !== 'ALL' && r.race_date !== selectedDate) return false;
      if (selectedMeet !== 'ALL' && r.meet !== selectedMeet) return false;
      return true;
    });

    const map = new Map<
      string,
      {
        key: string;
        race_date: string;
        meet: string;
        race_no: number;
        distance: number;
        horses: UpcomingRaceRow[];
      }
    >();

    for (const r of filtered) {
      const key = `${r.race_date}-${r.meet}-${r.race_no}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          race_date: r.race_date,
          meet: r.meet,
          race_no: r.race_no,
          distance: r.distance,
          horses: [],
        });
      }
      map.get(key)!.horses.push(r);
    }

    for (const group of map.values()) {
      group.horses.sort((a, b) => b.ai_score - a.ai_score);
    }

    return Array.from(map.values());
  }, [rows, selectedDate, selectedMeet]);

  // 과거 검증 결과 그룹화
  const groupedLogs = useMemo(() => {
    const filtered = logs.filter((r) => {
      if (selectedLogDate !== 'ALL' && r.race_date !== selectedLogDate) return false;
      if (selectedMeet !== 'ALL' && r.meet !== selectedMeet) return false;
      return true;
    });

    const map = new Map<
      string,
      {
        key: string;
        race_date: string;
        meet: string;
        race_no: number;
        distance: number;
        picks: PredictionLogRow[];
      }
    >();

    for (const r of filtered) {
      const key = `${r.race_date}-${r.meet}-${r.race_no}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          race_date: r.race_date,
          meet: r.meet,
          race_no: r.race_no,
          distance: r.distance,
          picks: [],
        });
      }
      map.get(key)!.picks.push(r);
    }

    return Array.from(map.values());
  }, [logs, selectedLogDate, selectedMeet]);

  const toggleExpand = (key: string) => {
    setExpandedRaces((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-500 text-slate-950">
                AI 단승 예측
              </span>
              <h1 className="text-xl font-extrabold tracking-tight text-white">
                MY-KEIBA 경마 승률 분석기
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              한국마사회 24,304건 연간 실전 기록 & 통산 전적 기반 AI 스코어링
            </p>
          </div>

          {/* 메인 모드 전환 탭 */}
          <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 self-start sm:self-auto">
            <button
              onClick={() => setActiveTab('UPCOMING')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'UPCOMING'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              이번 주 1등 예측 ({rows.length}두)
            </button>
            <button
              onClick={() => setActiveTab('RESULTS')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'RESULTS'
                  ? 'bg-emerald-500 text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              실전 적중 검증표 ({kpiStats.totalRaces}경주)
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 mt-5 space-y-5">
        {/* 상단 실시간 적중 성적표 KPI 배너 */}
        {kpiStats.totalRaces > 0 && (
          <section className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
              <div className="text-[11px] text-slate-400 font-medium">
                AI 1순위 단승(1착) 적중률
              </div>
              <div className="text-xl sm:text-2xl font-black text-amber-400 mt-1">
                {kpiStats.winRate}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {kpiStats.totalRaces}경주 중 {kpiStats.winHits}회 1위 적중
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
              <div className="text-[11px] text-slate-400 font-medium">
                AI 1순위 연승(3위 내) 입상률
              </div>
              <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">
                {kpiStats.placeRate}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {kpiStats.totalRaces}경주 중 {kpiStats.placeHits}회 입상
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
              <div className="text-[11px] text-slate-400 font-medium">
                TOP 3 추천마 내 우승 포함률
              </div>
              <div className="text-xl sm:text-2xl font-black text-sky-400 mt-1">
                {kpiStats.top3WinRate}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                추천 3두 이내 1착 배출 비율
              </div>
            </div>
          </section>
        )}

        {/* 필터 바 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          {activeTab === 'UPCOMING' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 mr-1">경주일</span>
              {dates.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  className={`px-3.5 py-1.5 rounded-xl text-sm font-bold transition ${
                    selectedDate === d
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {formatDateLabel(d)}
                </button>
              ))}
              <button
                onClick={() => setSelectedDate('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  selectedDate === 'ALL'
                    ? 'bg-slate-200 text-slate-950'
                    : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800'
                }`}
              >
                전체 일정
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 mr-1">검증일</span>
              {logDates.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedLogDate(d)}
                  className={`px-3.5 py-1.5 rounded-xl text-sm font-bold transition ${
                    selectedLogDate === d
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {formatDateLabel(d)}
                </button>
              ))}
              <button
                onClick={() => setSelectedLogDate('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  selectedLogDate === 'ALL'
                    ? 'bg-slate-200 text-slate-950'
                    : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800'
                }`}
              >
                전체 검증일
              </button>
            </div>
          )}

          {/* 경마장 선택 */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
            <span className="text-xs font-semibold text-slate-400 mr-1">경마장</span>
            {meets.map((m) => (
              <button
                key={m}
                onClick={() => setSelectedMeet(m)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                  selectedMeet === m
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {m === 'ALL' ? '전체 경마장' : m}
              </button>
            ))}
          </div>
        </div>

        {/* 본문 리스트 */}
        {loading ? (
          <div className="text-center py-20 text-slate-400">
            경마 데이터와 AI 분석 결과를 불러오는 중입니다...
          </div>
        ) : activeTab === 'UPCOMING' ? (
          /* 탭 1: 이번 주 1등 예측 */
          groupedRaces.length === 0 ? (
            <div className="text-center py-20 bg-slate-900 rounded-2xl border border-slate-800 text-slate-400">
              선택한 조건에 해당하는 예정 경주가 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groupedRaces.map((race) => {
                const top1 = race.horses[0];
                const top2 = race.horses[1];
                const scoreGap = top1 && top2 ? top1.ai_score - top2.ai_score : 0;
                const isStrongPick = scoreGap >= 12;
                const isCloseRace = top1 && top2 && scoreGap <= 4.5;

                const isExpanded = !!expandedRaces[race.key];
                const visibleHorses = isExpanded ? race.horses : race.horses.slice(0, 3);

                return (
                  <div
                    key={race.key}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between shadow-lg"
                  >
                    <div>
                      <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-800 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 text-xs font-bold rounded ${
                              race.meet === '서울'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                : race.meet === '부산경남'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                            }`}
                          >
                            {race.meet}
                          </span>
                          <span className="font-extrabold text-base text-white">
                            {race.race_no}경주
                          </span>
                          <span className="text-xs text-slate-400">
                            · {formatDateLabel(race.race_date)} · {race.distance}m
                          </span>
                        </div>

                        {/* 경주별 공략 전략 배지 */}
                        {isStrongPick ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                            ★ 단승 강력추천
                          </span>
                        ) : isCloseRace ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0">
                            접전 · 삼복승 권장
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 shrink-0">
                            {race.horses.length}두 출전
                          </span>
                        )}
                      </div>

                      {top1 && (
                        <div className="m-3 p-3.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/40">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span className="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center shadow shrink-0">
                                {top1.gate_no}
                              </span>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-amber-400">
                                    1등 유력
                                  </span>
                                  <span className="text-base font-extrabold text-white">
                                    {top1.horse_name}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-300 mt-0.5">
                                  기수 {top1.jockey_name} · 부담중량 {top1.weight}kg
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs text-amber-300/80">AI 점수</div>
                              <div className="text-xl font-black text-amber-400">
                                {top1.ai_score.toFixed(1)}
                              </div>
                            </div>
                          </div>
                          <ReasonChips reason={top1.reason} />
                        </div>
                      )}

                      <div className="px-3 pb-2 space-y-1.5">
                        {visibleHorses.map((h, idx) => (
                          <div
                            key={h.id}
                            className={`px-3 py-2.5 rounded-xl flex items-start justify-between text-xs ${
                              idx === 0
                                ? 'bg-slate-800/40 border border-slate-700/60'
                                : 'bg-slate-950/60 border border-slate-800/60'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 min-w-0">
                              <span
                                className={`w-5 h-5 mt-0.5 rounded font-bold flex items-center justify-center shrink-0 ${
                                  idx === 0
                                    ? 'bg-amber-500 text-slate-950'
                                    : idx === 1
                                    ? 'bg-slate-300 text-slate-950'
                                    : idx === 2
                                    ? 'bg-amber-700 text-white'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {idx + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-bold">
                                    {h.gate_no}번
                                  </span>
                                  <span className="font-bold text-slate-100">{h.horse_name}</span>
                                  <span className="text-slate-400">({h.jockey_name})</span>
                                </div>
                                <ReasonChips reason={h.reason} />
                              </div>
                            </div>
                            <div className="font-extrabold text-sm text-slate-200 ml-2 shrink-0">
                              {h.ai_score.toFixed(1)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {race.horses.length > 3 && (
                      <button
                        onClick={() => toggleExpand(race.key)}
                        className="w-full py-2.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-950/60 hover:bg-slate-800/80 border-t border-slate-800 transition"
                      >
                        {isExpanded
                          ? '상위 3두만 보기 ▲'
                          : `전체 출전마 ${race.horses.length}두 모두 보기 ▼`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* 탭 2: 실전 적중 검증표 (확정된 경주만 노출) */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groupedLogs.map((race) => {
              const top1Pick = race.picks.find((p) => p.predicted_rank === 1);
              return (
                <div
                  key={race.key}
                  className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                >
                  <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs font-bold rounded bg-slate-700 text-slate-200">
                        {race.meet}
                      </span>
                      <span className="font-extrabold text-base text-white">
                        {race.race_no}경주
                      </span>
                      <span className="text-xs text-slate-400">
                        · {formatDateLabel(race.race_date)} · {race.distance}m
                      </span>
                    </div>
                    {top1Pick?.is_win_hit ? (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-500 text-slate-950">
                        ★ 1순위 단승 적중
                      </span>
                    ) : top1Pick?.is_place_hit ? (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        연승 입상 ({top1Pick.actual_rank}착)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 text-slate-400">
                        실제 {top1Pick?.actual_rank ?? '-'}착
                      </span>
                    )}
                  </div>

                  <div className="p-3 space-y-2">
                    {race.picks.map((p) => (
                      <div
                        key={p.id}
                        className={`px-3 py-2.5 rounded-xl flex items-start justify-between text-xs border ${
                          p.actual_rank === 1
                            ? 'bg-amber-500/10 border-amber-500/40'
                            : p.actual_rank !== null && p.actual_rank <= 3
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-slate-950/60 border-slate-800'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="px-2 py-0.5 mt-0.5 rounded bg-slate-800 text-slate-300 font-bold shrink-0">
                            AI {p.predicted_rank}위
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-200">{p.gate_no}번</span>
                              <span className="font-extrabold text-white">{p.horse_name}</span>
                              <span className="text-slate-400">({p.jockey_name})</span>
                            </div>
                            <ReasonChips reason={p.reason} />
                          </div>
                        </div>

                        <div className="text-right shrink-0 ml-2">
                          <div
                            className={`text-sm font-black ${
                              p.actual_rank === 1
                                ? 'text-amber-400'
                                : p.actual_rank !== null && p.actual_rank <= 3
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {p.actual_rank ? `실제 ${p.actual_rank}착` : '경기 전'}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            예측 {p.ai_score.toFixed(1)}점
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 하단 안내 푸터 */}
        <footer className="pt-6 border-t border-slate-800/70 text-center text-[11px] text-slate-500 space-y-1">
          <p>
            본 서비스는 한국마사회 공공데이터의 과거 경주 기록 및 출전표 통계를 기반으로 산출된 AI 참고용 분석 정보입니다.
          </p>
          <p>
            실제 경주 결과는 당일 주로 상태, 마필 컨디션 및 전개에 따라 달라질 수 있으며 모든 선택의 책임은 이용자 본인에게 있습니다.
          </p>
        </footer>
      </div>
    </main>
  );
}