import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MY-KEIBA | AI 경마 승률 분석기 & 실시간 예측 검증',
  description:
    '한국마사회 24,304건 실전 경주 기록과 통산 전적, 주파 스피드 지수, 기수 승률을 분석해 서울·부산경남·제주 경마 1등 유력마를 예측합니다.',
  keywords: ['경마예측', 'AI경마', '서울경마', '부산경마', '제주경마', '경마승률분석', 'MY-KEIBA'],
  openGraph: {
    title: 'MY-KEIBA | AI 경마 승률 분석기',
    description: '한국마사회 실전 데이터 기반 AI 경마 1등 유력마 분석 및 적중 검증 플랫폼',
    url: 'https://my-keiba-beta.vercel.app',
    siteName: 'MY-KEIBA',
    type: 'website',
  },
  verification: {
    google: 'EnpIaQYC3yA1yqF',
    other: {
      'naver-site-verification': 'fe9dfdbc93c42332402e58acd0ff97ef027fb1e8',
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}