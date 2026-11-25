import { createRoot } from 'react-dom/client';
import { DemoGiftPage } from './components/DemoGiftPage';
import { setRewardSoundStorageKey } from './lib/reward-sound';
import './index.css';

/**
 * 🧪 체험용 데모 엔트리 — 실제 앱(StudyProvider·Supabase)과 완전히 분리되어 있습니다.
 * StrictMode 는 쓰지 않습니다(자동으로 한 번 여는 효과가 두 번 돌지 않게).
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root 를 찾을 수 없어요.');

// 🔊/🔇 설정도 이 페이지 안에서만 기억합니다(실제 앱 설정과 섞이지 않게).
setRewardSoundStorageKey('study-check.demo.reward-sound.v1');

createRoot(container).render(<DemoGiftPage />);
