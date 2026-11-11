# 症状自查助手 · HarmonyOS 版

这是网页版的鸿蒙原生移植：同一套数据、同一套分诊算法，界面用 ArkTS + ArkUI 重写。

- 语言：ArkTS（Stage 模型）
- 目标 SDK：HarmonyOS 5.0.0 (API 12)
- 设备：phone / tablet
- 依赖：无第三方库

## 环境要求

| 项目 | 要求 |
| --- | --- |
| DevEco Studio | 5.0 及以上 |
| HarmonyOS SDK | API 12（`5.0.0(12)`） |
| Node.js | DevEco 自带，无需单独装 |

## 打开工程

### 方式一：直接打开（先试这个）

DevEco Studio → **File → Open** → 选择 `harmony` 目录 → 等待 Sync。

如果 Sync 报 SDK 版本不匹配，把 `build-profile.json5` 里的 `compatibleSdkVersion` 改成你已安装的版本（例如 `"5.0.5(17)"`），或在 Project Structure 里改。

### 方式二：覆盖法（最稳，推荐给第一次接触鸿蒙的同学）

如果方式一因为 hvigor / SDK 版本对不上打不开，这样做：

1. DevEco Studio → **Create Project** → **Empty Ability** → 语言选 ArkTS，SDK 选你装好的最新版，工程名随意（例如 `SymptomChecker`）
2. 把本目录下这三处内容**覆盖**到新工程对应位置：
   - `entry/src/main/ets/` → 整个覆盖
   - `entry/src/main/resources/` → 整个覆盖
   - `AppScope/resources/` → 整个覆盖
3. 在 `entry/src/main/module.json5` 里确认 `pages` 指向 `$profile:main_pages`（新建工程默认就是）
4. Sync 后直接运行

好处：构建配置全部由 DevEco 按你本机的 SDK 生成，不会出现版本错配。

## 运行

1. 顶部工具栏 **Device Manager** 创建模拟器，或用数据线连真机（开启开发者模式 + USB 调试）
2. 首次运行需要签名：**File → Project Structure → Signing Configs → Automatically generate signature**（需登录华为账号）
3. 点 ▶ Run

> 模拟器上「立即拨打 120」按钮不会真的拨号（没有通话能力），属于正常现象；真机上会拉起拨号盘。

## 目录结构

```
harmony/
├── AppScope/
│   ├── app.json5                    应用级配置（包名、版本、图标）
│   └── resources/base/              应用图标、应用名
├── entry/
│   ├── src/main/
│   │   ├── ets/
│   │   │   ├── common/
│   │   │   │   ├── Data.ets         ⚠️ 自动生成：28 种疾病 / 73 个症状 / 14 组危险信号
│   │   │   │   └── Triage.ets       分诊逻辑：打分、危险信号、红黄绿判定
│   │   │   ├── entryability/
│   │   │   │   └── EntryAbility.ets 入口 Ability
│   │   │   └── pages/
│   │   │       └── Index.ets        全部界面（选症状 + 结果页）
│   │   ├── resources/               字符串、颜色、图标、页面路由
│   │   └── module.json5             模块配置
│   └── build-profile.json5
├── build-profile.json5              工程配置（SDK 版本在这里改）
└── hvigorfile.ts
```

## 数据从哪来

`common/Data.ets` **不是手写的**，由 `tools/gen-harmony-data.js` 从网页版 `site/index.html` 解析生成：

```bash
node tools/gen-harmony-data.js
```

所以：**改内容只改网页版数据源，然后重新生成**，两端永远不会不同步。
生成脚本自带校验（引用的症状 id 是否存在、core 是否在权重表里），有错会直接报错退出。

## 逻辑正确性

`common/Triage.ets` 是纯函数，不依赖 UI。作者已用 `tsc` 把 `Data.ets` + `Triage.ets` 当 TypeScript 编译后跑过对比测试，9 组典型输入（感冒样、吃坏肚子、头痛头晕、单个咽痛、尿路感染、结核可疑、胸痛+气短、高热+颈强、空选择）与网页版输出**完全一致**，包括红色危险信号判定。

想自己复跑：

```bash
mkdir -p .tmp/logic/src && cp entry/src/main/ets/common/{Data,Triage}.ets .tmp/logic/src/
cd .tmp/logic/src && mv Data.ets Data.ts && mv Triage.ets Triage.ts
npx tsc Data.ts Triage.ts --outDir ../out --target ES2017 --module commonjs --strict
```

## 已实现 / 待实现

**已实现**

- 症状多选（8 大系统 / 73 个症状）+ 关键字搜索
- 快速开始预设（感冒样、吃坏肚子、头痛头晕）
- 加权匹配排序（与 Web 版同一套算法）
- 红 / 黄 / 绿 三级分诊结论
- 危险信号拦截 + 一键拨打 120
- 每种情况的自我照护、常用药物（通用名 + 注意事项）、就医时机
- 适配手机与平板

**下一步（按比赛加分排序）**

1. **服务卡片**（Form）：把「用药提醒 / 复诊提醒」放到桌面
2. **元服务**：免安装直达，适合医疗工具类
3. **盘古大模型**：自由文本/语音描述症状 → 结构化抽取
4. **Health Kit**：接入心率、血氧，作为分诊辅助信号
5. **家庭档案**：老人/儿童/孕妇的用药禁忌差异
6. **数据看板**：本地统计（不联网），用于演示"分诊一致率"

## 已知风险（第一次跑可能遇到）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Sync 报 `compatibleSdkVersion` 不支持 | 本机 SDK 版本不同 | 改成你装的版本，或用「方式二」覆盖法 |
| 找不到 `@kit.AbilityKit` | SDK 较旧（API 11 以前） | 把 `Triage.ets` / `Index.ets` 的导入换成 `@ohos.app.ability.common` |
| 编译报 `Want` 缺少属性 | 类型校验更严 | 用 `const want: Want = { action: 'ohos.want.action.dial', uri: 'tel:120' }`，已按此写法 |
| 运行白屏 | `main_pages.json` 未注册页面 | 确认它是 `{"src":["pages/Index"]}` |
| 图标缺失报错 | 资源未覆盖完整 | 确认 `AppScope/resources/base/media/app_icon.png` 与 `entry/.../media/startIcon.png` 存在 |

## 与 Web 版的关系

| | Web 版 | HarmonyOS 版 |
| --- | --- | --- |
| 数据 | 手写在 `site/index.html` | 由 Web 版自动生成 |
| 算法 | `scoreConditions()` | `Triage.ets` 同逻辑 |
| 界面 | HTML/CSS | ArkTS/ArkUI |
| 分诊分级 | 无 | 红/黄/绿（鸿蒙版新增） |
| 分发 | 网址 | 应用市场 / 元服务 |

两个版本可以同时存在：Web 版用于快速演示和分享，鸿蒙版用于比赛评审。
