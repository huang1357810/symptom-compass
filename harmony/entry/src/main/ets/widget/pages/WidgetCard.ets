/**
 * 明辨康途 · 桌面服务卡片
 * 展示：最近一次方向 / 今日是否打卡 / 3 天未复查或建议就医
 * 点击卡片通过 router 直达应用结果页（由 Index 依据本机记录恢复）。
 */
@Entry
@Component
struct WidgetCard {
  @LocalStorageProp('lastDirName') lastDirName: string = '还没有记录';
  @LocalStorageProp('checkedInToday') checkedInToday: boolean = false;
  @LocalStorageProp('careDays') careDays: number = 0;
  @LocalStorageProp('advise') advise: string = '';

  build() {
    Column() {
      Row() {
        Text('明辨康途')
          .fontSize(13)
          .fontColor('#0E8F86')
          .fontWeight(FontWeight.Bold)
        Blank()
        Text(this.checkedInToday ? '今日已打卡' : '今日未打卡')
          .fontSize(10)
          .fontColor(this.checkedInToday ? '#0B6F68' : '#8A5A00')
          .backgroundColor(this.checkedInToday ? '#E9F7F4' : '#FFFBF2')
          .borderRadius(8)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
      }
      .width('100%')

      Text('最近一次方向')
        .fontSize(10)
        .fontColor('#6B8987')
        .margin({ top: 10 })
      Text(this.lastDirName)
        .fontSize(15)
        .fontColor('#103B38')
        .fontWeight(FontWeight.Medium)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ top: 2 })

      if (this.advise.length > 0) {
        Text('3 天内多次查看「' + this.advise + '」，建议就医')
          .fontSize(11)
          .fontColor('#B3271A')
          .maxLines(2)
          .margin({ top: 8 })
      } else if (this.careDays > 0) {
        Text('已经 ' + this.careDays.toString() + ' 天没复查，现在好些了吗？')
          .fontSize(11)
          .fontColor('#8A5A00')
          .maxLines(2)
          .margin({ top: 8 })
      } else {
        Text('点一下记录今天的状态')
          .fontSize(11)
          .fontColor('#6B8987')
          .margin({ top: 8 })
      }

      Blank()
      Text('查看结果 / 记录今天 ›')
        .fontSize(11)
        .fontColor('#0E8F86')
        .width('100%')
        .margin({ top: 6 })
    }
    .padding(12)
    .width('100%')
    .height('100%')
    .backgroundColor('#FFFFFF')
    .borderRadius(16)
    .onClick(() => {
      postCardAction(this, {
        action: 'router',
        abilityName: 'EntryAbility',
        params: { from: 'card' }
      });
    })
  }
}