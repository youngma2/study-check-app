import { useMemo, type ReactNode } from 'react';
import {
  StudyContext,
  type ActionResult,
  type CopyResult,
  type StudyContextValue,
} from './study-context';
import { createDemoDB, sortTasks, summarize } from './store';
import { DEFAULT_REWARD_SETTINGS, type RewardSettings } from './rewards';
import { defaultAppSettings } from './app-settings';

/**
 * 🧪 체험 페이지(demo.html) 전용 컨텍스트.
 *
 * 실제 앱의 StudyProvider 는 Supabase·localStorage 에 연결되지만, 이쪽은 **화면 안의 상태만** 씁니다.
 * · 서버(RPC)·실제 가족 DB 로 가는 요청 없음
 * · localStorage 에도 아무것도 쓰지 않음 (뽑기 기록은 화면에만)
 * 그래서 뽑기 상자 팝업(RewardGiftModal)을 한 줄도 바꾸지 않고 그대로 띄워 볼 수 있습니다.
 */

interface DemoStudyProviderProps {
  children: ReactNode;
  /** 상자 열기 — 체험 페이지가 화면 안에서만 처리합니다(저장 없음). */
  openReward: (eventId: string) => Promise<ActionResult>;
  /** 사용 완료 — 체험 페이지가 화면 안에서만 처리합니다(저장 없음). */
  useReward: (eventId: string) => Promise<ActionResult>;
  rewardSettings?: RewardSettings;
  /** 부모 화면처럼 '사용 완료' 버튼까지 보여 줄지 */
  isParent?: boolean;
}

const ok = async (): Promise<ActionResult> => ({ ok: true });

export function DemoStudyProvider({
  children,
  openReward,
  useReward,
  rewardSettings = DEFAULT_REWARD_SETTINGS,
  isParent = true,
}: DemoStudyProviderProps) {
  const value = useMemo<StudyContextValue>(() => {
    const db = createDemoDB();
    const member = db.members.find((item) => item.role === 'child') ?? db.members[0];
    const familyId = member.family_id;
    const tasksFor = (memberId: string, dateIso: string) =>
      sortTasks(db.tasks.filter((task) => task.member_id === memberId && task.due_date === dateIso));

    return {
      db,
      familyName: db.families.find((family) => family.id === familyId)?.name ?? '체험',
      members: db.members,
      parents: db.members.filter((item) => item.family_id === familyId && item.role === 'parent'),
      children: db.members.filter((item) => item.family_id === familyId && item.role === 'child'),
      currentMember: member,
      isParent,
      storageKind: 'local',
      syncState: 'local',
      realtimeState: 'off',
      parentUnlocked: true,
      parentPinSetupRequired: false,
      unlockParent: ok,
      setParentPin: ok,
      changeParentPin: ok,
      saveParentRecovery: async () => ({ ok: false, error: '체험 화면에서는 저장하지 않아요.' }),
      resetParentPinWithRecovery: async () => ({ ok: false, error: '체험 화면에서는 바꿀 수 없어요.' }),
      parentRecovery: null,
      parentPinRecoveryMode: false,
      lockParent: () => {},
      setCurrentMember: () => {},
      notes: [],
      notesState: 'ready',
      unseenNotes: [],
      markNotesSeen: () => {},
      addNote: ok,
      deleteNote: ok,
      postJjokkoNote: ok,
      enablePush: ok,
      seasonStatsFor: () => undefined,
      lastSeasonFor: () => null,
      tierEvents: [],
      tierEventsFor: () => [],
      tierEventsState: 'ready',
      rewardSettings,
      openReward,
      useReward,
      saveRewardSettings: ok,
      appSettings: defaultAppSettings(),
      setMemberEmoji: ok,
      burstFactor: 2,
      burstFactorText: '2배',
      profilePins: {},
      hasProfilePin: () => false,
      verifyProfilePin: ok,
      setProfilePin: ok,
      resetProfilePin: ok,
      saveChildProfile: async () => ({ ok: true, deviceOnly: true }),
      setChildProfilePin: async () => ({ ok: true, deviceOnly: true }),
      resetChildProfilePin: async () => ({ ok: true, deviceOnly: true }),
      createProfile: async () => ({ ok: false, error: '체험 화면에서는 만들 수 없어요.' }),
      monthlySettlementsFor: () => [],
      settingsSync: 'local',
      saveAppSettings: async () => ({ ok: true, localOnly: true }),
      consumeBonusTime: async () => ({ ok: false, error: '체험 화면에서는 쓸 수 없어요.' }),
      grantBonusTime: async () => ({ ok: false, error: '체험 화면에서는 쓸 수 없어요.' }),
      xpRules: {},
      burstActive: false,
      tasksFor,
      summaryFor: (memberId: string, dateIso: string) => summarize(tasksFor(memberId, dateIso)),
      addTask: ok,
      editTask: ok,
      setStatus: ok,
      removeTask: ok,
      copyTasks: async (): Promise<CopyResult> => ({ ok: true, created: 0, skipped: 0 }),
      renameMember: ok,
      resetDemo: ok,
    };
  }, [isParent, openReward, rewardSettings, useReward]);

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}
