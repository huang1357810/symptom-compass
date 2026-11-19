/**
 * 明辨康途 · 服务卡片（Form Kit）
 * 卡片数据来自本机 Preferences：最近方向 / 今日打卡 / 复查与就医提醒。
 */
import { common, Want } from '@kit.AbilityKit';
import { formBindingData, FormExtensionAbility, formProvider } from '@kit.FormKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { cardSummary, setCardFormId } from '../common/Profile';

const TAG: string = 'KangtuForm';

export default class EntryFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    const raw = want.parameters?.['ohos.extra.param.key.form_identity'];
    const formId: string = typeof raw === 'string' ? raw : '';
    this.refresh(formId);
    return formBindingData.createFormBindingData({
      lastDirName: '还没有记录',
      checkedInToday: false,
      careDays: 0,
      advise: ''
    });
  }

  onFormEvent(formId: string, message: string): void {
    this.refresh(formId);
  }

  onRemoveForm(formId: string): void {
    hilog.info(0x0000, TAG, 'form removed: %{public}s', formId);
  }

  private async refresh(formId: string): Promise<void> {
    try {
      const ctx = this.context as common.Context;
      await setCardFormId(ctx, formId);
      const s = await cardSummary(ctx);
      const binding = formBindingData.createFormBindingData({
        lastDirName: s.lastDirName,
        checkedInToday: s.checkedInToday,
        careDays: s.careDays,
        advise: s.advise
      });
      await formProvider.updateForm(formId, binding);
    } catch (e) {
      hilog.warn(0x0000, TAG, 'refresh failed: %{public}s', JSON.stringify(e));
    }
  }
}