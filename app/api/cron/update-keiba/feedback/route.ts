import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { category, message, contact } = await req.json();

    if (!message || String(message).trim().length < 2) {
      return NextResponse.json(
        { error: '내용을 2글자 이상 입력해 주세요.' },
        { status: 400 }
      );
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      return NextResponse.json(
        { error: '텔레그램 알림 설정이 완료되지 않았습니다.' },
        { status: 500 }
      );
    }

    const text = [
      `📩 [MY-KEIBA 새 피드백 도착]`,
      `• 유형: ${category || '기능 제안'}`,
      `• 내용: ${String(message).trim()}`,
      contact ? `• 회신처: ${String(contact).trim()}` : null,
      `• 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
    ]
      .filter(Boolean)
      .join('\n');

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });

    if (!tgRes.ok) {
      throw new Error('Telegram API 호출 실패');
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: '전송 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}