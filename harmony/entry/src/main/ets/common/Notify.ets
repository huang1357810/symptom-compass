/**
 * 明辨康途 · 本地提醒
 *   1. Notification Kit：应用内触发「3 天内同方向 3 次」时立即发系统通知
 *   2. reminderAgentManager：预约次日复查提醒，应用未打开也能由系统弹出
 */
import { common } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'KangtuNotify';
const ADVISE_ID: number = 1001;
const RECHECK_ID: number = 1002;

export async function ensureNotifyEnabled(ctx: common.UIAbilityContext): Promise<boolean> {
  try {
    let enabled: boolean = await notificationManager.isNotificationEnabled();
    if (!enabled) {
      await notificationManager.requestEnableNotification(ctx);
      enabled = await notificationManager.isNotificationEnabled();
    }
    return enabled;
  } catch (e) {
    hilog.warn(0x0000, TAG, 'notification permission failed: %{public}s', JSON.stringify(e));
    return false;
  }
}

/** 3 天内同一方向 ≥3 次：立即发通知（应用在后台时也会弹） */
export async function publishAdvise(ctx: common.UIAbilityContext, name: string, count: number): Promise<boolean> {
  const ok: boolean = await ensureNotifyEnabled(ctx);
  if (!ok) {
    return false;
  }
  try {
    const request: notificationManager.NotificationRequest = {
      id: ADVISE_ID,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: '明辨康途 · 建议就医',
          text: '你最近 3 天内 ' + count.toString() + ' 次查看「' + name + '」，症状反复时建议到医院当面看一下。',
          additionalText: '点击打开明辨康途'
        }
      }
    };
    await notificationManager.publish(request);
    return true;
  } catch (e) {
    hilog.warn(0x0000, TAG, 'publish failed: %{public}s', JSON.stringify(e));
    return false;
  }
}

/**
 * 预约次日 9:00 的复查提醒。
 * 使用日历代理提醒，应用未运行也能由系统弹出；需要 PUBLISH_AGENT_REMINDER 权限。
 */
export async function scheduleRecheck(ctx: common.UIAbilityContext, name: string): Promise<boolean> {
  const target = new Date(Date.now() + 24 * 3600 * 1000);
  const reminder: reminderAgentManager.ReminderRequestCalendar = {
    reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
    dateTime: {
      year: target.getFullYear(),
      month: target.getMonth() + 1,
      day: target.getDate(),
      hour: 9,
      minute: 0,
      second: 0
    },
    title: '明辨康途 · 复查提醒',
    content: '昨天你查看了「' + name + '」，今天好些了吗？点开记录一下。',
    notificationId: RECHECK_ID
  };
  try {
    await reminderAgentManager.publishReminder(reminder);
    return true;
  } catch (e) {
    hilog.warn(0x0000, TAG, 'reminder failed: %{public}s', JSON.stringify(e));
    return false;
  }
}

export async function cancelAdvise(): Promise<void> {
  try {
    await notificationManager.cancel(ADVISE_ID);
  } catch (e) {
  }
}