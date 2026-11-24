import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StudyProvider } from './lib/study-context';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root 를 찾을 수 없어요.');

createRoot(container).render(
  <StrictMode>
    <StudyProvider>
      <App />
    </StudyProvider>
  </StrictMode>,
);

// PWA: 홈 화면 설치를 위해 서비스 워커를 등록합니다. (빌드 결과에서만 — 개발 서버 캐시 방지)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => console.warn('서비스 워커 등록 실패', error));
  });
}
