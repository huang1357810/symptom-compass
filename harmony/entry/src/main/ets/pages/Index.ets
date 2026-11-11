/**
 * 症状自查助手 · HarmonyOS 版首页
 *
 * 单页三态：input（选症状）→ triage（三个追问）→ result（分诊结果）
 * 数据与逻辑分别在 common/Data.ets（自动生成）和 common/Triage.ets
 */
import { common, Want } from '@kit.AbilityKit';
import { GROUPS, SYMPTOMS, PRESETS, MedInfo, RedFlagDef } from '../common/Data';
import { ConditionResult, flagsFor, scoreConditions, triageOf, labelsOf, QUESTIONS, Question, QuestionOption, AnswerScore, answersScore } from '../common/Triage';

const TEAL: string = '#0E8F86';
const TEAL_DARK: string = '#0B6F68';
const INK: string = '#103B38';
const MUTED: string = '#6B8987';
const LINE: string = '#E2EEEC';
const BG: string = '#F2F8F8';
const CARD: string = '#FFFFFF';

@Entry
@Component
struct Index {
  @State phase: string = 'input';
  @State query: string = '';
  @State selected: string[] = [];
  @State results: ConditionResult[] = [];
  @State flags: RedFlagDef[] = [];
  @State triageLevel: string = '';
  @State triageTitle: string = '';
  @State triageAdvice: string = '';
  @State triageReasons: string[] = [];
  @State openIndex: number = 0;

  /* 三个追问的答案下标，-1 表示未答 */
  @State q1: number = -1;
  @State q2: number = -1;
  @State q3: number = -1;

  /* ---------- 逻辑 ---------- */

  private idsOfGroup(group: string): string[] {
    const out: string[] = [];
    const keys: string[] = Object.keys(SYMPTOMS);
    for (const id of keys) {
      const item = SYMPTOMS[id];
      if (item.group !== group) {
        continue;
      }
      if (this.query.length > 0 && item.label.indexOf(this.query) < 0) {
        continue;
      }
      out.push(id);
    }
    return out;
  }

  private toggle(id: string): void {
    const next: string[] = this.selected.slice();
    const i: number = next.indexOf(id);
    if (i >= 0) {
      next.splice(i, 1);
    } else {
      next.push(id);
    }
    this.selected = next;
  }

  private isPicked(id: string): boolean {
    return this.selected.includes(id);
  }

  private applyPreset(key: string): void {
    const ids: string[] = PRESETS[key];
    this.selected = ids.slice();
  }

  /** 进入追问；命中危险信号时直接出结果 */
  private analyze(): void {
    if (this.selected.length === 0) {
      return;
    }
    this.flags = flagsFor(this.selected);
    if (this.flags.length > 0) {
      this.runAnalysis();
      return;
    }
    this.phase = 'triage';
  }

  private answers(): Record<string, number> {
    const map: Record<string, number> = {};
    if (this.q1 >= 0) {
      map['duration'] = this.q1;
    }
    if (this.q2 >= 0) {
      map['fever'] = this.q2;
    }
    if (this.q3 >= 0) {
      map['activity'] = this.q3;
    }
    return map;
  }

  private answeredCount(): number {
    let n: number = 0;
    if (this.q1 >= 0) {
      n += 1;
    }
    if (this.q2 >= 0) {
      n += 1;
    }
    if (this.q3 >= 0) {
      n += 1;
    }
    return n;
  }

  private pick(qid: string, index: number): void {
    if (qid === 'duration') {
      this.q1 = index;
    } else if (qid === 'fever') {
      this.q2 = index;
    } else if (qid === 'activity') {
      this.q3 = index;
    }
  }

  private selectedOf(qid: string): number {
    if (qid === 'duration') {
      return this.q1;
    }
    if (qid === 'fever') {
      return this.q2;
    }
    if (qid === 'activity') {
      return this.q3;
    }
    return -1;
  }

  /** 真正计算并切到结果页 */
  private runAnalysis(): void {
    this.flags = flagsFor(this.selected);
    this.results = scoreConditions(this.selected);
    const t = triageOf(this.results, this.flags, this.answers());
    this.triageLevel = t.level;
    this.triageTitle = t.title;
    this.triageAdvice = t.advice;
    this.triageReasons = t.reasons;
    this.openIndex = this.results.length > 0 ? 0 : -1;
    this.phase = 'result';
  }

  private back(): void {
    this.phase = 'input';
  }

  private reset(): void {
    this.selected = [];
    this.query = '';
  }

  private dial(): void {
    const ctx = getContext(this) as common.UIAbilityContext;
    const want: Want = { action: 'ohos.want.action.dial', uri: 'tel:120' };
    ctx.startAbility(want).catch(() => {
    });
  }

  private triageColor(): string {
    if (this.triageLevel === 'red') {
      return '#B3271A';
    }
    if (this.triageLevel === 'green') {
      return '#0B6F68';
    }
    return '#8A5A00';
  }

  private triageBg(): string {
    if (this.triageLevel === 'red') {
      return '#FFF1EE';
    }
    if (this.triageLevel === 'green') {
      return '#E9F7F4';
    }
    return '#FFFBF2';
  }

  private scoreText(score: number): string {
    return Math.round(score * 100).toString() + '%';
  }

  /* ---------- 界面 ---------- */

  build() {
    Column() {
      this.HeaderBar()
      if (this.phase === 'input') {
        this.InputPanel()
      } else if (this.phase === 'triage') {
        this.TriagePanel()
      } else {
        this.ResultPanel()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(BG)
  }

  @Builder
  HeaderBar() {
    Row() {
      Text('+')
        .fontSize(28)
        .fontColor(Color.White)
        .width(44)
        .height(44)
        .textAlign(TextAlign.Center)
        .backgroundColor(TEAL)
        .borderRadius(14)
      Column() {
        Text('症状自查助手')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(Color.White)
        Text('选症状 · 看方向 · 知道何时该就医')
          .fontSize(12)
          .fontColor('#CFEDE9')
          .margin({ top: 3 })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .margin({ left: 12 })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 18, bottom: 22 })
    .backgroundColor(TEAL_DARK)
  }

  @Builder
  InputPanel() {
    Scroll() {
      Column() {
        Text('本工具仅用于健康科普，不能诊断疾病，也不能替代医生面诊。所有数据只保存在本机。')
          .fontSize(12)
          .fontColor('#41615F')
          .lineHeight(19)
          .padding(14)
          .width('100%')
          .backgroundColor('#F1FBF9')
          .borderRadius(12)

        TextInput({ placeholder: '搜索症状，例如：头痛、腹泻、眼睛痒', text: this.query })
          .height(44)
          .fontSize(14)
          .backgroundColor(CARD)
          .borderRadius(12)
          .margin({ top: 12 })
          .onChange((value: string) => {
            this.query = value;
          })

        Row() {
          Text('快速开始').fontSize(12).fontColor(MUTED)
          ForEach(['cold', 'gut', 'head'], (key: string) => {
            Text(key === 'cold' ? '感冒样' : (key === 'gut' ? '吃坏肚子' : '头痛头晕'))
              .fontSize(12)
              .fontColor(TEAL_DARK)
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .margin({ left: 8 })
              .borderRadius(14)
              .backgroundColor('#F6FCFB')
              .border({ width: 1, color: '#D5EEEA' })
              .onClick(() => {
                this.applyPreset(key);
              })
          }, (key: string) => key)
        }
        .width('100%')
        .margin({ top: 12 })

        Row() {
          Text('选择你的不适').fontSize(15).fontWeight(FontWeight.Medium).fontColor(INK)
          Blank()
          Text('已选 ' + this.selected.length + ' 项')
            .fontSize(12)
            .fontColor(TEAL_DARK)
            .padding({ left: 10, right: 10, top: 3, bottom: 3 })
            .backgroundColor('#E9F7F4')
            .borderRadius(12)
        }
        .width('100%')
        .margin({ top: 16, bottom: 4 })

        ForEach(GROUPS, (group: string) => {
          if (this.idsOfGroup(group).length > 0) {
            Column() {
              Text(group)
                .fontSize(11)
                .fontColor('#7D9C99')
                .width('100%')
                .margin({ top: 12, bottom: 6 })
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.idsOfGroup(group), (id: string) => {
                  Text(SYMPTOMS[id].label)
                    .fontSize(13)
                    .fontColor(this.isPicked(id) ? Color.White : '#25514F')
                    .padding({ left: 12, right: 12, top: 7, bottom: 7 })
                    .margin({ right: 8, bottom: 8 })
                    .borderRadius(16)
                    .backgroundColor(this.isPicked(id) ? TEAL : CARD)
                    .border({ width: 1, color: this.isPicked(id) ? TEAL : LINE })
                    .onClick(() => {
                      this.toggle(id);
                    })
                }, (id: string) => id)
              }
              .width('100%')
            }
            .width('100%')
          }
        }, (group: string) => group)

        Row() {
          Button('清空')
            .fontSize(14)
            .fontColor('#41615F')
            .backgroundColor(CARD)
            .borderRadius(12)
            .border({ width: 1, color: LINE })
            .height(42)
            .layoutWeight(1)
            .onClick(() => {
              this.reset();
            })
          Button('查看可能情况')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.White)
            .backgroundColor(this.selected.length > 0 ? TEAL : '#A8D5D0')
            .borderRadius(12)
            .height(42)
            .layoutWeight(2)
            .margin({ left: 10 })
            .enabled(this.selected.length > 0)
            .onClick(() => {
              this.analyze();
            })
        }
        .width('100%')
        .margin({ top: 18, bottom: 24 })
      }
      .padding({ left: 16, right: 16, top: 14 })
      .width('100%')
    }
    .layoutWeight(1)
    .scrollBar(BarState.Off)
  }

  @Builder
  TriagePanel() {
    Scroll() {
      Column() {
        Row() {
          Text('2. 补充三个问题')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(INK)
          Blank()
          Text(this.answeredCount().toString() + ' / 3')
            .fontSize(12)
            .fontColor(TEAL_DARK)
            .padding({ left: 10, right: 10, top: 3, bottom: 3 })
            .backgroundColor('#E9F7F4')
            .borderRadius(12)
        }
        .width('100%')
        .margin({ bottom: 8 })

        Text('这三个问题会明显影响分诊结论，请按实际情况选择。')
          .fontSize(12)
          .fontColor('#84A09D')
          .width('100%')
          .margin({ bottom: 12 })

        ForEach(QUESTIONS, (q: Question, qi: number) => {
          Column() {
            Text((qi + 1).toString() + '. ' + q.title)
              .fontSize(14.5)
              .fontWeight(FontWeight.Medium)
              .fontColor(INK)
              .width('100%')
            Text(q.hint)
              .fontSize(11)
              .fontColor('#8FA9A6')
              .width('100%')
              .margin({ top: 3, bottom: 10 })

            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(q.options, (opt: QuestionOption, oi: number) => {
                Text(opt.label)
                  .fontSize(13)
                  .fontColor(this.selectedOf(q.id) === oi ? Color.White : '#25514F')
                  .padding({ left: 13, right: 13, top: 8, bottom: 8 })
                  .margin({ right: 8, bottom: 8 })
                  .borderRadius(18)
                  .backgroundColor(this.selectedOf(q.id) === oi ? TEAL : CARD)
                  .border({ width: 1, color: this.selectedOf(q.id) === oi ? TEAL : LINE })
                  .onClick(() => {
                    this.pick(q.id, oi);
                  })
              }, (opt: QuestionOption) => opt.label)
            }
            .width('100%')
          }
          .width('100%')
          .padding(14)
          .backgroundColor(CARD)
          .borderRadius(14)
          .margin({ bottom: 10 })
          .alignItems(HorizontalAlign.Start)
        }, (q: Question) => q.id)

        Row() {
          Button('返回')
            .fontSize(14)
            .fontColor('#41615F')
            .backgroundColor(CARD)
            .borderRadius(12)
            .border({ width: 1, color: LINE })
            .height(42)
            .layoutWeight(1)
            .onClick(() => {
              this.phase = 'input';
            })
          Button('跳过')
            .fontSize(14)
            .fontColor('#41615F')
            .backgroundColor(CARD)
            .borderRadius(12)
            .border({ width: 1, color: LINE })
            .height(42)
            .layoutWeight(1)
            .margin({ left: 10 })
            .onClick(() => {
              this.runAnalysis();
            })
          Button('查看分诊结果')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.White)
            .backgroundColor(this.answeredCount() === 3 ? TEAL : '#A8D5D0')
            .borderRadius(12)
            .height(42)
            .layoutWeight(2)
            .margin({ left: 10 })
            .enabled(this.answeredCount() === 3)
            .onClick(() => {
              this.runAnalysis();
            })
        }
        .width('100%')
        .margin({ top: 8, bottom: 24 })
      }
      .padding({ left: 16, right: 16, top: 14 })
      .width('100%')
    }
    .layoutWeight(1)
    .scrollBar(BarState.Off)
  }

  @Builder
  ResultPanel() {
    Scroll() {
      Column() {
        Row() {
          Text('可能的方向').fontSize(16).fontWeight(FontWeight.Medium).fontColor(INK)
          Blank()
          Text('修改症状')
            .fontSize(12)
            .fontColor(TEAL_DARK)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor('#E9F7F4')
            .borderRadius(10)
            .onClick(() => {
              this.back();
            })
        }
        .width('100%')
        .margin({ bottom: 12 })

        Column() {
          Text(this.triageTitle)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.triageColor())
            .width('100%')
          Text(this.triageAdvice)
            .fontSize(12)
            .fontColor('#5C5A45')
            .lineHeight(19)
            .margin({ top: 6 })
            .width('100%')

          if (this.triageReasons.length > 0) {
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.triageReasons, (reason: string) => {
                Text(reason)
                  .fontSize(11)
                  .fontColor('#5D7B78')
                  .padding({ left: 9, right: 9, top: 3, bottom: 3 })
                  .margin({ right: 6, top: 8 })
                  .backgroundColor('#00000010')
                  .borderRadius(10)
              }, (reason: string) => reason)
            }
            .width('100%')
          }

          if (this.flags.length > 0) {
            ForEach(this.flags, (flag: RedFlagDef) => {
              Text('· ' + flag.title + '：' + flag.msg)
                .fontSize(12)
                .fontColor('#8A3A2A')
                .lineHeight(18)
                .margin({ top: 8 })
                .width('100%')
            }, (flag: RedFlagDef) => flag.title)

            Button('立即拨打 120')
              .fontSize(14)
              .fontColor(Color.White)
              .backgroundColor('#C0392B')
              .borderRadius(10)
              .height(40)
              .width('100%')
              .margin({ top: 12 })
              .onClick(() => {
                this.dial();
              })
          }
        }
        .width('100%')
        .padding(14)
        .backgroundColor(this.triageBg())
        .borderRadius(14)
        .alignItems(HorizontalAlign.Start)

        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(labelsOf(this.selected), (label: string) => {
            Text(label)
              .fontSize(11)
              .fontColor(TEAL_DARK)
              .padding({ left: 9, right: 9, top: 4, bottom: 4 })
              .margin({ right: 6, top: 8 })
              .backgroundColor('#E9F7F4')
              .borderRadius(10)
          }, (label: string) => label)
        }
        .width('100%')

        Text('按症状吻合程度排序。“匹配度”只表示症状吻合程度，不代表患病概率。')
          .fontSize(11)
          .fontColor('#84A09D')
          .lineHeight(17)
          .margin({ top: 10, bottom: 12 })
          .width('100%')

        ForEach(this.results, (item: ConditionResult, index: number) => {
          this.ConditionCard(item, index)
        }, (item: ConditionResult) => item.id)

        Column() {
          Text('用药安全 5 条底线')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(TEAL_DARK)
            .width('100%')
          Text('1. 不重复成分：多数复方感冒药含对乙酰氨基酚，叠加易过量伤肝。\n2. 抗生素不是消炎药，感冒流感不需要。\n3. 儿童青少年发热禁用阿司匹林。\n4. 孕妇、哺乳期、肝肾功能不全者先问医生。\n5. 按说明书剂量使用，止痛药连续不超过 3 天。')
            .fontSize(12)
            .fontColor('#4A6866')
            .lineHeight(20)
            .margin({ top: 8 })
            .width('100%')
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#F7FBFA')
        .borderRadius(12)
        .margin({ top: 6 })

        Text('免责声明：本页面仅用于健康教育与就医参考，不构成诊断或处方。具体用药须以药品说明书和医生意见为准。如症状迅速加重，请立即就医或拨打 120。')
          .fontSize(10)
          .fontColor('#7C9896')
          .lineHeight(16)
          .margin({ top: 14, bottom: 24 })
          .width('100%')
      }
      .padding({ left: 16, right: 16, top: 14 })
      .width('100%')
    }
    .layoutWeight(1)
    .scrollBar(BarState.Off)
  }

  @Builder
  ConditionCard(item: ConditionResult, index: number) {
    Column() {
      Row() {
        Text((index + 1).toString())
          .fontSize(12)
          .fontColor(Color.White)
          .width(26)
          .height(26)
          .textAlign(TextAlign.Center)
          .backgroundColor(index === 0 ? TEAL : '#9DBDB8')
          .borderRadius(8)
        Column() {
          Text(item.name)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(INK)
            .width('100%')
          Text(item.dept)
            .fontSize(10)
            .fontColor('#5D8B86')
            .margin({ top: 3 })
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .margin({ left: 10 })

        Text(this.scoreText(item.score))
          .fontSize(13)
          .fontColor(TEAL_DARK)
        Text(this.openIndex === index ? '︿' : '﹀')
          .fontSize(12)
          .fontColor('#A7C0BD')
          .margin({ left: 8 })
      }
      .width('100%')

      if (this.openIndex === index) {
        Column() {
          Text(item.summary)
            .fontSize(13)
            .fontColor('#42605E')
            .lineHeight(20)
            .margin({ top: 10 })
            .width('100%')

          Text('你提到的：' + item.matched.map((id: string) => SYMPTOMS[id].label).join('、'))
            .fontSize(11)
            .fontColor(TEAL_DARK)
            .margin({ top: 8 })
            .width('100%')

          Text('自我照护')
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(TEAL_DARK)
            .margin({ top: 12 })
            .width('100%')
          ForEach(item.care, (tip: string) => {
            Text('· ' + tip)
              .fontSize(12)
              .fontColor('#42605E')
              .lineHeight(19)
              .margin({ top: 4 })
              .width('100%')
          }, (tip: string) => tip)

          Text('常用药物（通用名）')
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(TEAL_DARK)
            .margin({ top: 12 })
            .width('100%')
          ForEach(item.meds, (med: MedInfo) => {
            Column() {
              Text(med.n).fontSize(12).fontColor(INK).width('100%')
              Text(med.note).fontSize(11).fontColor('#7B9694').lineHeight(17).margin({ top: 2 }).width('100%')
            }
            .width('100%')
            .margin({ top: 6 })
          }, (med: MedInfo) => med.n)

          Text('何时就医：' + item.see)
            .fontSize(11)
            .fontColor('#775515')
            .lineHeight(18)
            .padding(10)
            .margin({ top: 12 })
            .width('100%')
            .backgroundColor('#FFFBF2')
            .borderRadius(10)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(14)
    .backgroundColor(CARD)
    .borderRadius(14)
    .margin({ bottom: 10 })
    .onClick(() => {
      this.openIndex = this.openIndex === index ? -1 : index;
    })
  }
}
