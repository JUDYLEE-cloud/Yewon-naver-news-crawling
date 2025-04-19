const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const TARGET_URL = 'https://search.naver.com/search.naver?where=news&query=%EB%8B%A8%EB%8F%85+%EA%B5%AD%EB%AF%BC%EC%9D%98%ED%9E%98&sort=1';

let articles = [];

function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function getPublishedTime(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const text = $('body').text();
    const match = text.match(/(등록|입력|게재)[^\d]*(\d{4}[.\-\/]\d{2}[.\-\/]\d{2}[^\d]*(\d{2}:\d{2}(:\d{2})?)?)/);
    if (match) return match[2];
  } catch (err) {
    console.error(`❌ ${url}의 시간 추출 실패:`, err.message);
  }
  return null;
}

async function crawlNews() {
  try {
    const { data } = await axios.get(TARGET_URL);
    const $ = cheerio.load(data);

    const newArticles = [];
    const baseElements = $('div.sds-comps-base-layout').toArray();
    const verticalElements = $('div.sds-comps-vertical-layout').toArray();
    const elements = [...baseElements, ...verticalElements];
    for (const el of elements) {
      const titleEl = $(el).find('a span.sds-comps-text-ellipsis-1');
      const descEl = $(el).find('span.sds-comps-text-ellipsis-3');

      const title = titleEl.text().trim();
      const desc = descEl.text().trim();
      const href = $(el).find('a[href*="article"], a[href*="view"]').first().attr('href');

      const fullText = `${title} ${desc}`;
      if (
        fullText.includes('단독') &&
        (fullText.includes('국민의힘') || fullText.includes('국민의 힘')) &&
        href
      ) {
        if (!articles.find(a => a.link === href)) {
          const publishTime = await getPublishedTime(href);
          const finalTime = publishTime || getCurrentTime();
          const rawTime = publishTime ? new Date(publishTime) : new Date();
          newArticles.push({ title, link: href, time: finalTime, rawTime });
        }
      }
    }

    if (newArticles.length > 0) {
      const combined = [...newArticles, ...articles];
      const deduped = [];
      const seenLinks = new Set();
      for (const article of combined) {
        if (!seenLinks.has(article.link)) {
          seenLinks.add(article.link);
          deduped.push(article);
        }
      }
      deduped.sort((a, b) => b.rawTime - a.rawTime);
      articles = deduped.slice(0, 50); // 최신 50개만 유지
      io.emit('newsUpdate', articles);
      console.log(`[+] 새 기사 ${newArticles.length}개 전송됨`);
    }

  } catch (err) {
    console.error('❌ 크롤링 오류:', err.message);
  }
}

// 클라이언트에 정적 파일 제공
app.use(express.static('public'));

// 클라이언트 연결되었을 때 초기 데이터 전송
io.on('connection', (socket) => {
  console.log('🔌 클라이언트 연결됨');
  socket.emit('newsUpdate', articles);
});

// 3초마다 크롤링
setInterval(crawlNews, 3000);

server.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});