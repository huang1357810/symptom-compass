/*
 * 鸿蒙原生能力静态自测：node tools/test-harmony-native.js
 * 校验服务卡片（Form Kit）与本地提醒（Notification Kit / reminderAgent）的配置与接线。
 * 注意：ArkTS 最终仍需在 DevEco Studio 中编译与真机验证。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const H = path.join(ROOT, 'harmony', 'entry', 'src', 'main');
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';

const errors = [];
const must = (p, label) => {
  if (!fs.existsSync(p)) errors.push('缺少文件：' + label);
};

const profile = path.join(H, 'ets', 'common', 'Profile.ets');
const notify = path.join(H, 'ets', 'common', 'Notify.ets');
const formAbility = path.join(H, 'ets', 'entryformability', 'EntryFormAbility.ets');
const widget = path.join(H, 'ets', 'widget', 'pages', 'WidgetCard.ets');
const formConfig = path.join(H, 'resources', 'base', 'profile', 'form_config.json');
const moduleJson = path.join(H, 'module.json5');
const stringJson = path.join(H, 'resources', 'base', 'element', 'string.json');
const indexEts = path.join(H, 'ets', 'pages', 'Index.ets');
const abilityEts = path.join(H, 'ets', 'entryability', 'EntryAbility.ets');

[profile, notify, formAbility, widget, formConfig].forEach(p => must(p, path.relative(ROOT, p)));

const profileText = read(profile);
const notifyText = read(notify);
const formText = read(formAbility);
const widgetText = read(widget);
const indexText = read(indexEts);
const abilityText = read(abilityEts);
const moduleText = read(moduleJson);

/* 1. 服务卡片配置 */
try {
  const cfg = JSON.parse(read(formConfig) || '{}');
  const forms = cfg.forms || [];
  if (!forms.length) errors.push('form_config.json 里没有 forms');
  const f = forms[0] || {};
  if (!f.src || f.src.indexOf('WidgetCard') === -1) errors.push('form_config 的 src 未指向 WidgetCard.ets');
  if (!f.supportDimensions || f.supportDimensions.length === 0) errors.push('form_config 缺少 supportDimensions');
} catch (e) {
  errors.push('form_config.json 不是合法 JSON：' + e.message);
}

/* 2. module.json5 注册 */
if (moduleText.indexOf('"type": "form"') === -1) errors.push('module.json5 未注册 type=form 的 extensionAbility');
if (moduleText.indexOf('ohos.extension.form') === -1) errors.push('module.json5 缺少 form 元数据');
if (moduleText.indexOf('$profile:form_config') === -1) errors.push('module.json5 未引用 form_config');
if (moduleText.indexOf('PUBLISH_AGENT_REMINDER') === -1) errors.push('module.json5 未声明代理提醒权限');

/* 3. string.json 名称 */
try {
  const s = JSON.parse(read(stringJson) || '{}');
  const names = (s.string || []).map(x => x.name);
  ['form_name', 'form_desc'].forEach(n => {
    if (names.indexOf(n) === -1) errors.push('string.json 缺少 ' + n);
  });
} catch (e) {
  errors.push('string.json 不是合法 JSON：' + e.message);
}

/* 4. 档案与规则 */
['pendingAdvise', 'recordVisit', 'checkInToday', 'refreshCard', 'formProvider.updateForm', 'cardSummary', 'ADVISE_TIMES'].forEach(k => {
  if (profileText.indexOf(k) === -1) errors.push('Profile.ets 缺少 ' + k);
});

/* 5. 通知与代理提醒 */
['notificationManager.publish', 'requestEnableNotification', 'reminderAgentManager.publishReminder'].forEach(k => {
  if (notifyText.indexOf(k) === -1) errors.push('Notify.ets 缺少 ' + k);
});

/* 6. 卡片页面 */
['@LocalStorageProp', 'lastDirName', 'checkedInToday', 'careDays', 'postCardAction', "action: 'router'"].forEach(k => {
  if (widgetText.indexOf(k) === -1) errors.push('WidgetCard.ets 缺少 ' + k);
});

/* 7. 卡片数据刷新 */
['cardSummary', 'formBindingData.createFormBindingData', 'formProvider.updateForm', 'setCardFormId'].forEach(k => {
  if (formText.indexOf(k) === -1) errors.push('EntryFormAbility.ets 缺少 ' + k);
});

/* 8. 主页面接线 */
['recordVisit', 'publishAdvise', 'scheduleRecheck', 'checkInToday', 'aboutToAppear', 'doCheckIn', 'launchFrom'].forEach(k => {
  if (indexText.indexOf(k) === -1) errors.push('Index.ets 缺少 ' + k);
});

/* 9. 启动参数 */
if (abilityText.indexOf("want.parameters") === -1 || abilityText.indexOf('launchFrom') === -1) {
  errors.push('EntryAbility.ets 未把 from 参数写入 AppStorage');
}

if (errors.length) {
  console.error('鸿蒙原生能力静态校验失败：\n  ' + errors.join('\n  '));
} else {
  console.log('服务卡片与本地提醒静态校验通过（仍需 DevEco 编译 + 真机验证）');
}
process.exit(errors.length ? 1 : 0);