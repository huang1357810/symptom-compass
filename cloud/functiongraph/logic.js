/**
 * 分诊逻辑（服务端）
 * ⚠️ 由 tools/gen-cloud-logic.js 从 site/index.html 自动生成，请勿手工修改。
 * 该 script 末尾已自带 module.exports，因此可直接被 require。
 */


/* =========================================================
   数据层
   ========================================================= */
const GROUPS = ['全身','头面','呼吸','消化','泌尿生殖','皮肤','骨骼肌肉','神经与情绪'];

const SYMPTOMS = {
  /* 全身 */
  fever:{label:'发热',group:'全身'},
  high_fever:{label:'高热 ≥39℃',group:'全身'},
  chills:{label:'畏寒/寒战',group:'全身'},
  fatigue:{label:'乏力',group:'全身'},
  night_sweat:{label:'夜间盗汗',group:'全身'},
  weight_loss:{label:'体重下降',group:'全身'},
  poor_appetite:{label:'食欲不振',group:'全身'},
  pallor:{label:'面色苍白',group:'全身'},
  dehydration:{label:'口干/少尿',group:'全身'},

  /* 头面 */
  headache:{label:'头痛',group:'头面'},
  dizziness:{label:'头晕',group:'头面'},
  sore_throat:{label:'咽痛',group:'头面'},
  congestion:{label:'鼻塞',group:'头面'},
  runny_nose:{label:'流涕',group:'头面'},
  sneeze:{label:'打喷嚏',group:'头面'},
  smell_loss:{label:'嗅觉/味觉减退',group:'头面'},
  facial_pain:{label:'面部压痛',group:'头面'},
  toothache:{label:'牙痛',group:'头面'},
  ear_pain:{label:'耳痛',group:'头面'},
  tinnitus:{label:'耳鸣',group:'头面'},
  hearing_loss:{label:'听力下降',group:'头面'},
  eye_itch:{label:'眼痒',group:'头面'},
  eye_red:{label:'眼红',group:'头面'},
  eye_discharge:{label:'眼分泌物增多',group:'头面'},
  eye_pain:{label:'眼痛',group:'头面'},
  vision_blur:{label:'视物模糊',group:'头面'},
  photophobia:{label:'畏光',group:'头面'},

  /* 呼吸 */
  dry_cough:{label:'干咳',group:'呼吸'},
  sputum:{label:'咳痰',group:'呼吸'},
  chest_tight:{label:'胸闷',group:'呼吸'},
  dyspnea:{label:'气短/呼吸困难',group:'呼吸'},
  hemoptysis:{label:'咯血',group:'呼吸'},
  wheeze:{label:'喘息/喘鸣',group:'呼吸'},
  chest_pain:{label:'胸痛',group:'呼吸'},

  /* 消化 */
  nausea:{label:'恶心',group:'消化'},
  vomiting:{label:'呕吐',group:'消化'},
  abdominal_pain:{label:'腹痛',group:'消化'},
  severe_abd:{label:'剧烈腹痛',group:'消化'},
  diarrhea:{label:'腹泻',group:'消化'},
  constipation:{label:'便秘',group:'消化'},
  heartburn:{label:'反酸/烧心',group:'消化'},
  bloating:{label:'腹胀',group:'消化'},
  gi_bleed:{label:'呕血/黑便',group:'消化'},
  dysphagia:{label:'吞咽困难',group:'消化'},
  rectal_bleeding:{label:'便血',group:'消化'},
  anal_pain:{label:'肛门疼痛/肿物',group:'消化'},

  /* 泌尿生殖 */
  urinary_freq:{label:'尿频/尿急',group:'泌尿生殖'},
  dysuria:{label:'尿痛',group:'泌尿生殖'},
  hematuria:{label:'血尿',group:'泌尿生殖'},
  flank_pain:{label:'腰侧痛',group:'泌尿生殖'},
  dysmenorrhea:{label:'经期下腹痛',group:'泌尿生殖'},
  vaginal_discharge:{label:'白带异常',group:'泌尿生殖'},
  pregnancy_bleed:{label:'孕期出血/腹痛',group:'泌尿生殖'},

  /* 皮肤 */
  rash:{label:'皮疹',group:'皮肤'},
  itch:{label:'瘙痒',group:'皮肤'},
  hives:{label:'风团',group:'皮肤'},
  dry_skin:{label:'皮肤干燥脱屑',group:'皮肤'},
  blister:{label:'水疱',group:'皮肤'},

  /* 骨骼肌肉 */
  joint_pain:{label:'关节痛',group:'骨骼肌肉'},
  joint_swelling:{label:'关节红肿发热',group:'骨骼肌肉'},
  back_pain:{label:'腰背痛',group:'骨骼肌肉'},
  neck_pain:{label:'颈肩痛',group:'骨骼肌肉'},
  myalgia:{label:'肌肉酸痛',group:'骨骼肌肉'},

  /* 神经与情绪 */
  insomnia:{label:'失眠',group:'神经与情绪'},
  anxious:{label:'焦虑/紧张',group:'神经与情绪'},
  low_mood:{label:'情绪低落',group:'神经与情绪'},
  palpitation:{label:'心悸',group:'神经与情绪'},
  numbness:{label:'手脚麻木',group:'神经与情绪'},
  weakness_one_side:{label:'单侧肢体无力',group:'神经与情绪'},
  speech_diff:{label:'言语不清',group:'神经与情绪'},
  seizure:{label:'抽搐',group:'神经与情绪'},
  confusion:{label:'意识模糊',group:'神经与情绪'},
  stiff_neck:{label:'颈部僵硬',group:'神经与情绪'}
};

const CONDITIONS = [
  {
    id:'cold', name:'普通感冒', dept:'呼吸内科 / 全科', tag:'最常见',
    summary:'以鼻塞、流涕、咽部不适为主，多由病毒引起，通常 1 周左右自行好转。',
    symptoms:{runny_nose:1, congestion:0.9, sneeze:0.8, sore_throat:0.7, dry_cough:0.6, fever:0.4, fatigue:0.5, headache:0.4, myalgia:0.3, smell_loss:0.3},
    core:['runny_nose','congestion','sneeze','sore_throat'],
    care:['多休息、多饮水，保证睡眠','温盐水漱口缓解咽痛','保持室内湿度，避免冷风直吹','复方感冒药只选一种，避免成分重复'],
    meds:[
      {n:'对乙酰氨基酚', note:'退热止痛；勿与其他含同成分的感冒药同服，避免过量伤肝'},
      {n:'布洛芬', note:'退热止痛；胃溃疡、肾功能不全者慎用，饭后服'},
      {n:'生理性海水鼻腔喷雾', note:'缓解鼻塞，温和安全；减充血剂连续使用不超过 7 天'}
    ],
    see:'超过 10 天不缓解、高热不退、出现耳痛/气短/咳黄脓痰，或婴幼儿精神差时就医。'
  },
  {
    id:'flu', name:'流行性感冒', dept:'呼吸内科', tag:'起病急',
    summary:'起病急，高热伴明显肌肉酸痛、乏力，传染性强，冬春季多见。',
    symptoms:{fever:1, myalgia:0.9, fatigue:0.9, chills:0.7, headache:0.7, dry_cough:0.6, sore_throat:0.5, poor_appetite:0.5, congestion:0.3},
    core:['fever','myalgia'],
    care:['居家休息并适当隔离，避免传染家人','多饮水，监测体温变化','老人、孕妇、儿童及有基础病者尽早评估','咳嗽打喷嚏时遮挡，勤洗手'],
    meds:[
      {n:'对乙酰氨基酚 / 布洛芬', note:'退热止痛，按说明书间隔使用，两种不要交替叠加'},
      {n:'奥司他韦', note:'处方药，发病 48 小时内使用效果最好，需医生评估后使用'}
    ],
    see:'高热超过 3 天、呼吸困难、胸痛、意识改变，或属于高危人群，应尽快就医。'
  },
  {
    id:'allergic_rhinitis', name:'过敏性鼻炎', dept:'耳鼻喉科 / 变态反应科', tag:'反复发作',
    summary:'接触花粉、尘螨后出现阵发性喷嚏、清水样鼻涕，常伴眼痒，脱离环境可缓解。',
    symptoms:{sneeze:1, runny_nose:1, congestion:0.9, eye_itch:0.7, itch:0.3, dry_cough:0.2, smell_loss:0.3},
    core:['sneeze','runny_nose'],
    care:['减少接触过敏原，花粉季外出戴口罩','回家后洗脸、洗鼻、换外衣','生理盐水冲洗鼻腔','保持室内清洁，勤晒被褥'],
    meds:[
      {n:'氯雷他定 / 西替利嗪', note:'二代抗组胺药，嗜睡较轻，规律服用比按需更有效'},
      {n:'糠酸莫米松鼻喷雾', note:'需连续使用数天起效，属处方药，长期使用需医生指导'}
    ],
    see:'症状影响睡眠和工作、出现喘息胸闷，或需要长期用药时，到耳鼻喉科/过敏科评估。'
  },
  {
    id:'pharyngitis', name:'急性咽炎 / 扁桃体炎', dept:'耳鼻喉科', tag:'',
    summary:'咽部疼痛、吞咽时加重，可为病毒感染，也可为细菌性扁桃体炎。',
    symptoms:{sore_throat:1, dysphagia:0.7, fever:0.6, fatigue:0.4, headache:0.3, congestion:0.2},
    core:['sore_throat'],
    care:['温盐水漱口，每日数次','多饮水，避免烟酒和辛辣食物','减少说话，让声带休息','保持室内空气湿润'],
    meds:[
      {n:'对乙酰氨基酚 / 布洛芬', note:'缓解咽痛和发热，饭后服用'},
      {n:'局部含片（如溶菌酶含片）', note:'仅缓解局部不适，效果有限，不要依赖'}
    ],
    see:'高热、张口困难、单侧扁桃体明显肿大、颈部肿块，或症状超过 1 周。是否用抗生素须医生判断，不要自行服用。'
  },
  {
    id:'bronchitis', name:'急性支气管炎', dept:'呼吸内科', tag:'',
    summary:'感冒后咳嗽加重、可有痰，多由病毒引起，咳嗽可能持续 2–3 周。',
    symptoms:{dry_cough:1, sputum:0.9, chest_tight:0.5, wheeze:0.4, fever:0.4, fatigue:0.4, sore_throat:0.3},
    core:['dry_cough','sputum'],
    care:['多饮水，帮助稀释痰液','避免冷空气、烟雾和油烟刺激','咳嗽期间不要强行憋咳','多数不需要抗生素'],
    meds:[
      {n:'氨溴索 / 乙酰半胱氨酸', note:'祛痰药，痰多黏稠时优先，服后多饮水'},
      {n:'右美沙芬', note:'仅用于干咳影响睡眠时；痰多者不宜使用'}
    ],
    see:'咯血、气短、高热不退、咳嗽超过 3 周，或原有心肺疾病者，需就医。'
  },
  {
    id:'pneumonia', name:'肺炎', dept:'呼吸内科 / 急诊', tag:'需就医',
    summary:'发热伴咳嗽咳痰、气短，可能为肺部感染，需要医生听诊和胸片/CT 评估。',
    symptoms:{fever:0.9, high_fever:0.85, sputum:0.9, dry_cough:0.7, dyspnea:0.8, chest_tight:0.7, chills:0.6, fatigue:0.6, poor_appetite:0.4},
    core:['dyspnea','sputum','high_fever'],
    care:['尽早就医，不要自行使用抗生素','注意休息，适量补液','有条件可监测血氧饱和度','老人可能不发热，仅表现为精神差、食欲下降'],
    meds:[
      {n:'抗生素', note:'必须由医生根据病情处方，切勿自行服用、减量或停药'}
    ],
    see:'出现气短、呼吸急促、口唇发紫、意识改变或高热不退，请立即就医或拨打 120。'
  },
  {
    id:'tb', name:'肺结核（需排查）', dept:'呼吸内科 / 结核病定点医院', tag:'需筛查',
    summary:'咳嗽咳痰超过 2 周，伴午后低热、夜间盗汗、体重下降，需排查肺结核。',
    symptoms:{dry_cough:0.9, sputum:0.8, fever:0.7, night_sweat:0.9, weight_loss:0.9, fatigue:0.6, poor_appetite:0.6, hemoptysis:0.7, chest_pain:0.3, dyspnea:0.3},
    core:['night_sweat','weight_loss','hemoptysis'],
    care:['戴口罩，避免近距离传染家人','不要随地吐痰，痰液需妥善处理','尽早做胸片/CT 和痰检，这是确诊关键','加强营养、规律作息，戒烟酒','确诊后抗结核药必须足疗程，不可自行停药'],
    meds:[
      {n:'抗结核药（异烟肼、利福平等）', note:'必须由结核病定点医院规范处方，全程督导服药；自行购买或中断治疗会导致耐药'}
    ],
    see:'咳嗽咳痰超过 2 周、痰中带血、盗汗消瘦，请到呼吸科或结核病防治机构就诊；确诊后需按规范隔离治疗。'
  },
  {
    id:'gerd', name:'胃食管反流', dept:'消化内科', tag:'',
    summary:'反酸、烧心，餐后或平卧时加重，可伴慢性干咳和咽部不适。',
    symptoms:{heartburn:1, nausea:0.3, dry_cough:0.4, sore_throat:0.3, bloating:0.4, chest_tight:0.3, dysphagia:0.3},
    core:['heartburn'],
    care:['少食多餐，避免过饱','睡前 3 小时不进食，床头抬高 15–20 cm','减少咖啡、浓茶、酒、高脂和辛辣食物','超重者减重，避免紧身衣物'],
    meds:[
      {n:'铝碳酸镁', note:'中和胃酸，短期缓解烧心，与其他药物间隔 1–2 小时'},
      {n:'奥美拉唑等质子泵抑制剂', note:'饭前服用，疗程需医生指导，长期使用需评估'}
    ],
    see:'吞咽困难、体重下降、黑便、贫血，或症状每周多次影响生活；40 岁以上新发症状建议胃镜评估。'
  },
  {
    id:'gastroenteritis', name:'急性胃肠炎', dept:'消化内科', tag:'多可自愈',
    summary:'进食不洁后出现腹泻、呕吐、腹痛，多为病毒或细菌感染，关键是防脱水。',
    symptoms:{diarrhea:1, nausea:0.9, vomiting:0.9, abdominal_pain:0.8, fever:0.5, poor_appetite:0.5, dehydration:0.4},
    core:['diarrhea','vomiting'],
    care:['口服补液盐少量多次，是最重要的处理','清淡饮食，腹泻期间避免牛奶和高脂食物','注意手卫生，避免传染家人','不要自行使用止泻药（尤其发热或血便时）'],
    meds:[
      {n:'口服补液盐 III', note:'补液首选，按说明冲配，少量多次饮用'},
      {n:'蒙脱石散', note:'吸附毒素，与其他药物间隔 1–2 小时'},
      {n:'益生菌', note:'辅助恢复，与抗生素间隔 2 小时服用'}
    ],
    see:'血便、高热、剧烈腹痛、明显脱水（口干、少尿、头晕），或持续超过 3 天；婴幼儿、老人、孕妇应更早就医。'
  },
  {
    id:'dyspepsia', name:'功能性消化不良', dept:'消化内科', tag:'',
    summary:'餐后饱胀、早饱、上腹不适，检查常无明显器质性病变，与饮食和压力相关。',
    symptoms:{bloating:0.9, poor_appetite:0.7, nausea:0.6, abdominal_pain:0.6, heartburn:0.5, constipation:0.2},
    core:['bloating'],
    care:['规律进食、细嚼慢咽','减少油腻、产气和过冷食物','适度运动，管理压力','避免餐后立即躺下'],
    meds:[
      {n:'多潘立酮', note:'促动力药，短期使用；心脏病患者及孕妇慎用，需咨询医生'},
      {n:'复方消化酶', note:'辅助消化，餐中或餐后服用'}
    ],
    see:'体重下降、贫血、黑便、吞咽困难、反复呕吐，或 40 岁以上新发、症状持续加重，需胃镜等检查。'
  },
  {
    id:'constipation', name:'便秘', dept:'消化内科', tag:'',
    summary:'排便次数减少、粪便干硬或排便费力，多与饮水、膳食纤维和活动量不足有关。',
    symptoms:{constipation:1, bloating:0.7, abdominal_pain:0.4, poor_appetite:0.2},
    core:['constipation'],
    care:['每日饮水 1.5–2 L','增加膳食纤维：蔬菜、全谷、火龙果、西梅','规律如厕，不要长期憋便','适度运动，避免久坐'],
    meds:[
      {n:'乳果糖', note:'渗透性泻剂，温和，可较长期使用，起效需 1–2 天'},
      {n:'聚乙二醇 4000', note:'渗透性泻剂，需充足饮水'},
      {n:'开塞露', note:'临时应急，不宜长期依赖'}
    ],
    see:'便血、体重下降、贫血、新发便秘超过 2 周（尤其 50 岁以上），或排便习惯明显改变。'
  },
  {
    id:'migraine', name:'偏头痛', dept:'神经内科', tag:'',
    summary:'单侧搏动性头痛，伴恶心、畏光，活动后加重，可持续 4–72 小时。',
    symptoms:{headache:1, nausea:0.7, photophobia:0.6, vomiting:0.5, vision_blur:0.4, dizziness:0.3},
    core:['headache'],
    care:['发作时在安静、昏暗环境休息','记录诱因：睡眠不足、红酒、奶酪、月经周期','规律作息和进餐，避免过度饥饿','适度有氧运动'],
    meds:[
      {n:'布洛芬 / 萘普生', note:'发作早期使用效果更好，饭后服，胃病者慎用'},
      {n:'对乙酰氨基酚', note:'轻中度疼痛可用，避免与复方感冒药重复'},
      {n:'曲普坦类', note:'处方药，需医生评估，心血管疾病者禁用'}
    ],
    see:'突发“一生最剧烈”的头痛、伴发热颈强、肢体无力或言语不清，须立即急诊；每月用止痛药超过 10 天应就诊。'
  },
  {
    id:'tension_headache', name:'紧张性头痛', dept:'神经内科 / 全科', tag:'最常见',
    summary:'双侧紧箍样压迫性头痛，常与压力、久坐、睡眠不足和颈肩紧张有关。',
    symptoms:{headache:1, neck_pain:0.6, anxious:0.5, insomnia:0.4, fatigue:0.3, dizziness:0.2},
    core:['headache'],
    care:['热敷颈肩，轻柔拉伸','每 45 分钟起身活动，调整坐姿','规律作息，保证睡眠','深呼吸、放松训练'],
    meds:[
      {n:'对乙酰氨基酚 / 布洛芬', note:'短期使用，每周不超过 2–3 天，避免药物过度使用性头痛'}
    ],
    see:'头痛性质改变、进行性加重、伴神经症状，或每月止痛药使用超过 10 天。'
  },
  {
    id:'uti', name:'尿路感染', dept:'泌尿外科 / 肾内科', tag:'',
    summary:'尿频、尿急、尿痛，多为细菌感染，女性更常见。',
    symptoms:{urinary_freq:1, dysuria:1, hematuria:0.6, flank_pain:0.5, fever:0.4, abdominal_pain:0.3},
    core:['dysuria','urinary_freq'],
    care:['多饮水，增加排尿冲刷','不憋尿，注意会阴清洁','治疗期间避免性生活','完成医生开具的全程疗程，不要症状一好就停药'],
    meds:[
      {n:'抗生素（如呋喃妥因、磷霉素）', note:'均为处方药，需医生根据尿检结果选择，不要自行购买服用'}
    ],
    see:'发热、寒战、腰侧痛（可能为上尿路感染）、血尿，男性或孕期出现症状，应尽快就医。'
  },
  {
    id:'kidney_stone', name:'泌尿系结石', dept:'泌尿外科 / 急诊', tag:'疼痛剧烈',
    summary:'突发腰侧绞痛，可向会阴部放射，常伴血尿、恶心呕吐。',
    symptoms:{flank_pain:1, hematuria:0.7, nausea:0.5, abdominal_pain:0.5, urinary_freq:0.4, vomiting:0.3},
    core:['flank_pain'],
    care:['无呕吐时大量饮水','记录疼痛位置和尿量','小结石可能自行排出，但需医生确认','不要热敷腹部，可能加重不适'],
    meds:[
      {n:'双氯芬酸 / 布洛芬', note:'止痛，需医生评估肾功能后使用'},
      {n:'坦索罗辛', note:'处方药，辅助排石，需医生指导'}
    ],
    see:'疼痛剧烈无法缓解、发热寒战、无尿、呕吐无法进水，请立即急诊。'
  },
  {
    id:'dysmenorrhea', name:'痛经', dept:'妇科', tag:'',
    summary:'经期下腹痉挛性疼痛，原发性多见；进行性加重需排除子宫内膜异位症等。',
    symptoms:{dysmenorrhea:1, back_pain:0.6, nausea:0.4, headache:0.2, diarrhea:0.2, fatigue:0.3},
    core:['dysmenorrhea'],
    care:['下腹热敷，每次 15–20 分钟','经期适度活动，避免受凉','规律作息，减少咖啡因','记录疼痛程度与周期变化'],
    meds:[
      {n:'布洛芬 / 萘普生', note:'经期开始或疼痛出现时服用，饭后服；胃病、哮喘者慎用'}
    ],
    see:'疼痛逐年加重、经量过多、非经期也痛、备孕困难，或止痛药无效，需妇科检查。'
  },
  {
    id:'vaginitis', name:'阴道炎', dept:'妇科', tag:'',
    summary:'白带增多、性状或气味改变，可伴外阴瘙痒，常见为细菌性、霉菌性或滴虫性。',
    symptoms:{vaginal_discharge:1, itch:0.6, dysuria:0.3, abdominal_pain:0.3},
    core:['vaginal_discharge'],
    care:['保持外阴清洁干燥，穿棉质内裤','不要冲洗阴道内部，会破坏正常菌群','治疗期间避免性生活','滴虫性阴道炎需要伴侣同时治疗'],
    meds:[
      {n:'抗真菌栓剂 / 甲硝唑', note:'必须先做白带常规明确类型再用药，不同类型用药完全不同，均为处方药'}
    ],
    see:'首次出现、反复发作、伴下腹痛或发热、孕期出现症状，需妇科检查；不要自行长期使用栓剂。'
  },
  {
    id:'anemia', name:'缺铁性贫血', dept:'血液科 / 全科', tag:'',
    summary:'乏力、头晕、面色苍白、活动后心悸气短，可能与缺铁或慢性失血有关。',
    symptoms:{fatigue:1, dizziness:0.8, palpitation:0.7, pallor:0.7, dyspnea:0.5, headache:0.3},
    core:['fatigue','pallor'],
    care:['多吃富含铁的食物：红肉、动物肝、血制品','搭配维生素 C 促进铁吸收','避免餐后立即喝浓茶和咖啡','不要自行长期补铁，先明确贫血类型'],
    meds:[
      {n:'铁剂（如琥珀酸亚铁）', note:'需先查血常规和铁蛋白，遵医嘱服用；可能引起黑便和胃部不适'}
    ],
    see:'必须先查血常规明确贫血类型；男性或绝经后女性贫血，要排查消化道出血。'
  },
  {
    id:'eczema', name:'湿疹 / 皮炎', dept:'皮肤科', tag:'',
    summary:'皮肤干燥、红斑、丘疹伴瘙痒，容易反复发作。',
    symptoms:{itch:1, rash:1, dry_skin:0.8, blister:0.3},
    core:['itch','rash'],
    care:['每天足量保湿，是最重要的一步','洗澡水温不宜过高、时间不宜过长','穿棉质宽松衣物，避免抓挠','避免已知刺激物和过敏原'],
    meds:[
      {n:'弱效糖皮质激素软膏（如氢化可的松）', note:'短期局部使用，面部和皮肤薄处慎用，症状控制后逐渐停'},
      {n:'抗组胺药', note:'止痒用；夜间可选用有嗜睡作用的第一代药物'}
    ],
    see:'皮损渗液、脓疱、发热（可能继发感染），或大面积反复发作影响睡眠。'
  },
  {
    id:'urticaria', name:'荨麻疹', dept:'皮肤科', tag:'',
    summary:'突然出现风团、剧烈瘙痒，单个皮损多在 24 小时内消退，可反复成批出现。',
    symptoms:{hives:1, itch:0.9, rash:0.6, dyspnea:0.2},
    core:['hives'],
    care:['寻找并避免诱因：食物、药物、冷热刺激、压力','不要热水烫洗，避免剧烈搔抓','穿宽松衣物，保持凉爽','记录发作时间和可疑接触物'],
    meds:[
      {n:'西替利嗪 / 氯雷他定', note:'二代抗组胺药，规律服用比痒了才吃更有效'}
    ],
    see:'出现口唇/眼睑肿胀、呼吸困难、声音嘶哑、头晕（警惕过敏性休克），请立即急诊。'
  },
  {
    id:'conjunctivitis', name:'结膜炎', dept:'眼科', tag:'',
    summary:'眼红、分泌物增多或眼痒，可为过敏性，也可为细菌/病毒感染。',
    symptoms:{eye_red:1, eye_discharge:0.8, eye_itch:0.8, eye_pain:0.4, vision_blur:0.2},
    core:['eye_red'],
    care:['冷敷缓解不适','勤洗手，不要揉眼','毛巾、脸盆单独使用','暂停佩戴隐形眼镜，停用眼部化妆品'],
    meds:[
      {n:'奥洛他定滴眼液', note:'过敏性结膜炎常用，需药师/医生指导'},
      {n:'抗生素滴眼液', note:'仅细菌性使用，需医生判断，勿与他人共用'}
    ],
    see:'视力下降、剧烈眼痛、明显畏光、角膜混浊，或佩戴隐形眼镜期间发生，请尽快眼科就诊。'
  },
  {
    id:'otitis', name:'急性中耳炎', dept:'耳鼻喉科', tag:'儿童多见',
    summary:'耳痛、听力下降，常继发于感冒，儿童更常见。',
    symptoms:{ear_pain:1, fever:0.6, hearing_loss:0.5, tinnitus:0.4, headache:0.3},
    core:['ear_pain'],
    care:['以止痛为主，多数可自行缓解','避免耳朵进水','不要自行掏耳或滴入药物','感冒时正确擤鼻，避免用力过猛'],
    meds:[
      {n:'布洛芬 / 对乙酰氨基酚', note:'止痛退热，按体重或说明书剂量使用'}
    ],
    see:'儿童、症状超过 48–72 小时、耳流脓、高热或耳后红肿，需耳鼻喉科评估是否使用抗生素。'
  },
  {
    id:'dental', name:'牙痛 / 智齿冠周炎', dept:'口腔科', tag:'',
    summary:'牙痛、咬合痛或智齿周围红肿，多为龋齿、牙髓炎或冠周炎。',
    symptoms:{toothache:1, facial_pain:0.6, fever:0.4, dysphagia:0.3, headache:0.2},
    core:['toothache'],
    care:['温盐水漱口，保持口腔清洁','避免患侧咀嚼和过冷过热食物','不要自行挑破牙龈或使用偏方','尽快预约口腔科处理病因'],
    meds:[
      {n:'布洛芬', note:'止痛，饭后服；只能暂时缓解，不能替代牙科治疗'},
      {n:'甲硝唑', note:'处方药，仅医生诊断为厌氧菌感染时使用，服药期间及停药后 3 天内禁酒'}
    ],
    see:'面部肿胀、张口受限、发热、吞咽或呼吸困难，请尽快口腔科或急诊处理。'
  },
  {
    id:'low_back', name:'腰肌劳损 / 腰椎问题', dept:'骨科 / 康复科', tag:'',
    summary:'久坐或负重后腰背酸痛，活动后可能加重，休息可缓解。',
    symptoms:{back_pain:1, myalgia:0.4, numbness:0.4, neck_pain:0.2},
    core:['back_pain'],
    care:['避免久坐和弯腰搬重物','急性期适度休息，但不宜长期卧床','热敷，轻柔拉伸','加强核心肌群锻炼'],
    meds:[
      {n:'布洛芬', note:'短期止痛，饭后服，不超过 3–5 天'},
      {n:'双氯芬酸二乙胺凝胶', note:'外用，局部刺激小，皮肤破损处禁用'}
    ],
    see:'下肢放射痛/麻木无力、大小便功能障碍（需急诊）、发热、外伤后疼痛，或超过 6 周不缓解。'
  },
  {
    id:'cervical', name:'颈椎病', dept:'骨科 / 康复科', tag:'',
    summary:'颈肩僵硬疼痛，可伴手臂麻木、头晕，与长期低头、姿势不良有关。',
    symptoms:{neck_pain:1, numbness:0.7, headache:0.5, dizziness:0.5, myalgia:0.3},
    core:['neck_pain'],
    care:['调整屏幕高度，保持视线平齐','每 30–45 分钟活动颈部','热敷颈肩，避免高枕','避免长时间低头看手机'],
    meds:[
      {n:'布洛芬', note:'短期止痛'},
      {n:'甲钴胺', note:'营养神经，需医生指导，不要长期自行服用'}
    ],
    see:'手臂麻木无力加重、走路不稳、手精细动作变差，需骨科/神经科评估。'
  },
  {
    id:'gout', name:'痛风', dept:'风湿免疫科', tag:'夜间突发',
    summary:'突发单关节（多见于大脚趾）红、肿、热、剧痛，常在夜间或饮酒后发作。',
    symptoms:{joint_pain:1, joint_swelling:1, fever:0.3},
    core:['joint_pain','joint_swelling'],
    care:['抬高患肢，局部冷敷','大量饮水，促进尿酸排泄','急性期避免饮酒、海鲜、动物内脏和含糖饮料','不要热敷或按摩患处'],
    meds:[
      {n:'布洛芬 / 依托考昔', note:'抗炎止痛，需医生评估心血管和肾功能'},
      {n:'秋水仙碱', note:'处方药，越早使用效果越好，需遵医嘱，腹泻时减量'}
    ],
    see:'首次发作需查血尿酸并排除感染性关节炎；发热伴关节红肿需急诊排除化脓性关节炎。'
  },
  {
    id:'sleep_anxiety', name:'失眠 / 焦虑状态', dept:'精神心理科 / 睡眠门诊', tag:'',
    summary:'入睡困难、易醒或紧张不安，常与压力、作息紊乱和情绪有关。',
    symptoms:{insomnia:1, anxious:0.9, low_mood:0.6, palpitation:0.5, fatigue:0.5, headache:0.3, dizziness:0.2},
    core:['insomnia','anxious'],
    care:['固定起床时间，比固定入睡时间更重要','睡前 1 小时远离屏幕，避免咖啡因和酒精','卧室只用于睡眠，睡不着就起身离开','白天适度运动，但避免睡前剧烈运动'],
    meds:[
      {n:'褪黑素', note:'短期调节节律，个体差异大，不建议长期大剂量使用'},
      {n:'安眠/抗焦虑药', note:'均为处方药，需医生评估，不可自行长期服用或突然停药'}
    ],
    see:'持续超过 1 个月影响工作生活，或出现明显情绪低落、兴趣减退，建议精神心理科/睡眠门诊。'
  },
  {
    id:'hemorrhoids', name:'痔疮', dept:'肛肠科', tag:'',
    summary:'便血（鲜红色）、肛门疼痛或肿物脱出，常与便秘、久坐、久蹲有关。',
    symptoms:{rectal_bleeding:1, anal_pain:0.8, constipation:0.5, itch:0.3},
    core:['rectal_bleeding','anal_pain'],
    care:['温水坐浴 10–15 分钟，每日 1–2 次','增加膳食纤维和水分，避免用力排便','避免久坐久蹲，如厕不玩手机','保持肛周清洁干燥'],
    meds:[
      {n:'痔疮膏 / 栓剂', note:'含局麻或激素成分，短期使用，孕妇慎用'},
      {n:'乳果糖', note:'软化粪便，减少排便对创面的刺激'}
    ],
    see:'便血持续或量大、贫血、体重下降、40 岁以上新发便血，需排查结直肠疾病。'
  }
];

/* 危险信号 */
const RED_FLAGS = [
  {ids:['chest_pain'], title:'胸痛', msg:'压榨样胸痛、放射至左臂或下颌、伴大汗或气短，可能是心肌梗死，请立即拨打 120。'},
  {ids:['dyspnea'], title:'呼吸困难', msg:'明显气短、呼吸费力、不能平卧或口唇发紫，请立即就医。'},
  {ids:['hemoptysis'], title:'咯血', msg:'咳出血性痰液或鲜血，需要尽快排查肺部疾病。'},
  {ids:['gi_bleed'], title:'呕血 / 黑便', msg:'提示上消化道出血，请立即急诊。'},
  {ids:['weakness_one_side'], title:'单侧肢体无力', msg:'突发一侧手脚无力或麻木，可能是脑卒中，越早溶栓效果越好，立即拨打 120。'},
  {ids:['speech_diff'], title:'言语不清', msg:'突然说话含糊、听不懂别人说话，可能是脑卒中，立即拨打 120。'},
  {ids:['seizure'], title:'抽搐', msg:'首次抽搐或抽搐持续不缓解，需立即急诊处理。'},
  {ids:['confusion'], title:'意识模糊', msg:'意识不清、答非所问、嗜睡难唤醒，需立即就医。'},
  {ids:['stiff_neck','high_fever'], mode:'all', title:'高热 + 颈部僵硬', msg:'需警惕脑膜炎，请立即急诊。'},
  {ids:['severe_abd'], title:'剧烈腹痛', msg:'腹痛剧烈、拒按或伴冷汗，需排除急腹症，请立即就医。'},
  {ids:['dehydration'], title:'明显脱水', msg:'口干、少尿、头晕、站起时眼前发黑，需尽快补液并就医。'},
  {ids:['pregnancy_bleed'], title:'孕期出血 / 腹痛', msg:'孕期出现阴道出血或腹痛，请立即到产科急诊。'},
  {ids:['eye_pain','vision_blur'], mode:'all', title:'眼痛 + 视力下降', msg:'可能为急性青光眼等眼科急症，需立即就诊。'},
  {ids:['high_fever','rash'], mode:'all', title:'高热 + 皮疹', msg:'需急诊排查严重感染或药物反应。'}
];

const PRESETS = {
  cold:['congestion','runny_nose','sore_throat','fatigue'],
  gut:['diarrhea','nausea','abdominal_pain','vomiting'],
  head:['headache','dizziness','nausea','insomnia']
};

/* 分诊问卷：三个问题，score 越高越需要尽快就医 */
const QUESTIONS = [
  {
    id: 'duration',
    title: '症状持续多久了？',
    hint: '从第一个症状出现算起',
    options: [
      { label: '今天刚开始', score: 0, reason: '' },
      { label: '1–3 天', score: 0, reason: '' },
      { label: '4–7 天', score: 1, reason: '症状已持续 4–7 天' },
      { label: '超过 1 周', score: 2, reason: '症状持续超过 1 周' }
    ]
  },
  {
    id: 'fever',
    title: '有没有发热？最高多少度？',
    hint: '按测量到的最高温度选',
    options: [
      { label: '没有发热', score: 0, reason: '' },
      { label: '37.3–38℃', score: 1, reason: '低热 37.3–38℃' },
      { label: '38.1–39℃', score: 2, reason: '中度发热 38.1–39℃' },
      { label: '超过 39℃', score: 3, reason: '高热超过 39℃' }
    ]
  },
  {
    id: 'activity',
    title: '目前的状态怎么样？',
    hint: '按最难受的时候判断',
    options: [
      { label: '活动正常', score: 0, reason: '' },
      { label: '影响工作，但能自理', score: 1, reason: '已影响日常活动' },
      { label: '卧床，需要人照顾', score: 3, reason: '需要卧床、无法自理' }
    ]
  }
];

/* =========================================================
   逻辑层（纯函数，便于校验）
   ========================================================= */
const SYMPTOM_IDS = Object.keys(SYMPTOMS);
const RED_SET = new Set(RED_FLAGS.flatMap(f => f.ids));

function flagsFor(selected){
  return RED_FLAGS.filter(f => {
    const mode = f.mode || 'any';
    return mode === 'all' ? f.ids.every(id => selected.has(id)) : f.ids.some(id => selected.has(id));
  });
}

function scoreConditions(selectedIds){
  const sel = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const minHit = sel.size >= 3 ? 2 : 1;

  const scored = CONDITIONS.map(c => {
    const entries = Object.entries(c.symptoms);
    let total = 0, hit = 0;
    const matched = [];
    for (const [sid, w] of entries){
      total += w;
      if (sel.has(sid)){ hit += w; matched.push(sid); }
    }
    const score = total ? hit / total : 0;
    const coreHit = (c.core || []).some(s => sel.has(s));
    return Object.assign({}, c, {score, matched, coreHit});
  });

  return scored
    .filter(c => c.matched.length >= minHit && c.score >= 0.18 && (c.coreHit || c.score >= 0.5))
    .sort((a, b) => b.score - a.score || b.matched.length - a.matched.length)
    .slice(0, 8);
}

function gradeOf(score){
  if (score >= 0.65) return ['吻合度较高', 'hi'];
  if (score >= 0.42) return ['中等吻合', ''];
  return ['吻合度较低', ''];
}

/* =========================================================
   视图层
   ========================================================= */
const selected = new Set();
let chipMap = {};

/* 云端分诊 API（部署在华为云 FunctionGraph 时自动启用，否则本地计算） */
const CLOUD = { enabled: false, endpoint: '/api/triage' };

async function detectCloud(){
  try {
    const resp = await fetch('/api/triage/health', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.ok === true){
      CLOUD.enabled = true;
    }
  } catch (e) {
    /* 没有云端 API，保持本地分析 */
  }
}

/* 问卷答案：{ 问题id: 选项下标 } */
const answers = {};

function showTriage(){
  if (!selected.size) return;
  /* 命中危险信号时跳过问卷，直接给出急诊提示——不能让人先答三个问题才看到警告 */
  if (flagsFor(selected).length > 0){
    showResults();
    return;
  }
  renderQuestions();
  document.getElementById('intake').classList.add('hidden');
  document.getElementById('notice').classList.add('hidden');
  document.getElementById('results').classList.add('hidden');
  document.getElementById('triage').classList.remove('hidden');
  updateTriageProgress();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function renderQuestions(){
  const box = document.getElementById('questions');
  box.innerHTML = QUESTIONS.map((q, qi) =>
    '<div class="qcard">' +
      '<div class="qtitle">' + (qi + 1) + '. ' + q.title + (q.hint ? '<i>' + q.hint + '</i>' : '') + '</div>' +
      '<div class="qopts">' +
        q.options.map((o, oi) =>
          '<button type="button" class="opt' + (answers[q.id] === oi ? ' on' : '') + '" data-q="' + q.id + '" data-i="' + oi + '">' + o.label + '</button>'
        ).join('') +
      '</div>' +
    '</div>'
  ).join('');

  box.querySelectorAll('.opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.dataset.q;
      answers[qid] = Number(btn.dataset.i);
      box.querySelectorAll('.opt[data-q="' + qid + '"]').forEach(b => b.classList.toggle('on', b === btn));
      updateTriageProgress();
    });
  });
}

function updateTriageProgress(){
  const n = Object.keys(answers).length;
  document.getElementById('triageProgress').textContent = n + ' / 3';
  document.getElementById('toResults').disabled = n < 3;
}

/* 问卷加权：0–8 分 */
function triageScore(){
  let score = 0;
  const reasons = [];
  QUESTIONS.forEach(q => {
    const idx = answers[q.id];
    if (idx === undefined) return;
    const opt = q.options[idx];
    score += opt.score;
    if (opt.reason) reasons.push(opt.reason);
  });
  return { score, reasons };
}

/* 红 / 黄 / 绿 三级分诊 */
function computeTriage(results, flags){
  if (flags.length){
    return {
      level: 'red',
      title: '建议立即就医',
      advice: '你选择的症状里有需要紧急处理的情况，不适合自我观察或自行用药。请立即前往医院急诊，紧急时拨打 120。',
      reasons: flags.map(f => f.title),
      flags: flags
    };
  }

  const t = triageScore();
  if (!results.length){
    return {
      level: 'yellow',
      title: '信息不足，建议面诊',
      advice: '没有匹配到足够接近的情况，症状组合可能不典型。建议补充症状，或直接到医院让医生面诊。',
      reasons: t.reasons,
      flags: []
    };
  }

  const top = results[0];
  const urgentDept = top.dept.indexOf('急诊') >= 0 || top.tag === '需就医';

  if (t.score >= 7){
    return {
      level: 'red',
      title: '建议今天内就医',
      advice: '结合病程、体温和活动能力，整体情况偏重，建议今天内前往医院就诊，不要继续自行观察。',
      reasons: t.reasons,
      flags: []
    };
  }
  if (urgentDept){
    return {
      level: 'yellow',
      title: '建议 24 小时内就诊',
      advice: '最可能的情况需要医生评估，不宜长期自行处理。建议尽快到 ' + top.dept + ' 就诊。',
      reasons: t.reasons,
      flags: []
    };
  }
  if (t.score >= 3){
    return {
      level: 'yellow',
      title: '建议尽快就诊',
      advice: '症状已经持续或影响到日常活动，建议这两天到 ' + top.dept + ' 检查一下。',
      reasons: t.reasons,
      flags: []
    };
  }
  return {
    level: 'green',
    title: '可以先观察',
    advice: '目前整体偏轻，可以先按下方建议自我照护。若 3 天内没有好转，或症状加重，请及时就医。',
    reasons: t.reasons,
    flags: []
  };
}

function init(){
  document.getElementById('stat-cond').textContent = CONDITIONS.length;
  document.getElementById('stat-sym').textContent = SYMPTOM_IDS.length;

  renderGroups();
  bindEvents();
  updateCount();
  detectCloud();

  /* 支持通过 #s=症状id,症状id 直接打开结果，方便把当前选择分享给家人或医生 */
  try {
    if (location.hash.indexOf('#s=') === 0){
      const ids = decodeURIComponent(location.hash.slice(3)).split(',').filter(id => SYMPTOMS[id]);
      if (ids.length){
        ids.forEach(id => selected.add(id));
        Object.entries(chipMap).forEach(([id, ch]) => {
          const on = selected.has(id);
          ch.classList.toggle('on', on);
          ch.setAttribute('aria-pressed', String(on));
        });
        updateCount();
        showResults();
      }
    }
  } catch (e) { /* 忽略非法链接参数 */ }
}

function renderGroups(){
  const wrap = document.getElementById('groups');
  wrap.textContent = '';
  chipMap = {};

  GROUPS.forEach(g => {
    const ids = SYMPTOM_IDS.filter(id => SYMPTOMS[id].group === g);
    if (!ids.length) return;

    const sec = document.createElement('div');
    sec.className = 'group';
    sec.dataset.group = g;

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = g;

    const box = document.createElement('div');
    box.className = 'chips';

    ids.forEach(id => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.id = id;
      b.textContent = SYMPTOMS[id].label;
      b.setAttribute('aria-pressed', 'false');
      if (RED_SET.has(id)) b.classList.add('flag');
      b.addEventListener('click', () => toggle(id));
      box.appendChild(b);
      chipMap[id] = b;
    });

    sec.appendChild(title);
    sec.appendChild(box);
    wrap.appendChild(sec);
  });
}

function toggle(id){
  if (selected.has(id)){
    selected.delete(id);
  } else {
    selected.add(id);
  }
  const chip = chipMap[id];
  if (chip){
    chip.classList.toggle('on', selected.has(id));
    chip.setAttribute('aria-pressed', String(selected.has(id)));
  }
  updateCount();
}

function updateCount(){
  const n = selected.size;
  document.getElementById('count').textContent = '已选 ' + n + ' 项';
  document.getElementById('go').disabled = n === 0;
}

function clearAll(){
  selected.clear();
  Object.values(chipMap).forEach(c => {
    c.classList.remove('on');
    c.setAttribute('aria-pressed', 'false');
  });
  updateCount();
}

function bindEvents(){
  document.getElementById('go').addEventListener('click', showTriage);
  document.getElementById('clear').addEventListener('click', clearAll);
  document.getElementById('back').addEventListener('click', () => {
    document.getElementById('results').classList.add('hidden');
    document.getElementById('triage').classList.add('hidden');
    document.getElementById('intake').classList.remove('hidden');
    document.getElementById('notice').classList.remove('hidden');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    window.scrollTo({top: 0, behavior: 'smooth'});
  });

  document.getElementById('triageBack').addEventListener('click', () => {
    document.getElementById('triage').classList.add('hidden');
    document.getElementById('intake').classList.remove('hidden');
    document.getElementById('notice').classList.remove('hidden');
    window.scrollTo({top: 0, behavior: 'smooth'});
  });

  document.getElementById('toResults').addEventListener('click', showResults);

  document.getElementById('skipTriage').addEventListener('click', () => {
    showResults();
  });

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('.group').forEach(sec => {
      let any = false;
      sec.querySelectorAll('.chip').forEach(ch => {
        const show = !q || ch.textContent.toLowerCase().includes(q);
        ch.style.display = show ? '' : 'none';
        if (show) any = true;
      });
      sec.style.display = any ? '' : 'none';
    });
  });

  document.querySelectorAll('.preset').forEach(btn => {
    btn.addEventListener('click', () => {
      clearAll();
      (PRESETS[btn.dataset.preset] || []).forEach(id => {
        if (SYMPTOMS[id]) selected.add(id);
      });
      Object.entries(chipMap).forEach(([id, ch]) => {
        const on = selected.has(id);
        ch.classList.toggle('on', on);
        ch.setAttribute('aria-pressed', String(on));
      });
      updateCount();
      showTriage();
    });
  });
}

async function showResults(){
  if (!selected.size) return;

  let results = null;
  let flags = null;
  let mode = '本地分析';

  /* 部署在华为云 FunctionGraph 上时，优先走云端分诊 API；失败自动回退本地 */
  if (CLOUD.enabled){
    try {
      const resp = await fetch(CLOUD.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptoms: [...selected] })
      });
      if (resp.ok){
        const data = await resp.json();
        if (Array.isArray(data.results) && Array.isArray(data.flags)){
          results = data.results;
          flags = data.flags;
          mode = '云端分析';
        }
      }
    } catch (e) {
      CLOUD.enabled = false;
    }
  }

  if (results === null){
    results = scoreConditions(selected);
    flags = flagsFor(selected);
  }

  const badge = document.getElementById('modeBadge');
  if (badge){
    badge.textContent = mode;
    badge.classList.toggle('cloud', mode === '云端分析');
  }

  /* 三色分诊 */
  const triage = computeTriage(results, flags);
  const levelLabel = { red: '高风险 · 需急诊', yellow: '中风险 · 需就医', green: '低风险 · 可观察' };
  document.getElementById('urgent').innerHTML =
    '<div class="triage ' + triage.level + ' fade">' +
      '<span class="lv">' + (levelLabel[triage.level] || '分诊结果') + '</span>' +
      '<h3>' + triage.title + '</h3>' +
      '<p>' + triage.advice + '</p>' +
      (triage.reasons.length
        ? '<div class="reasons">' + triage.reasons.map(r => '<span>' + r + '</span>').join('') + '</div>'
        : '') +
      (triage.level === 'red' && flags.length
        ? '<ul>' + flags.map(f => '<li><b>' + f.title + '</b>：' + f.msg + '</li>').join('') + '</ul>' +
          '<a class="call" href="tel:120">📞 立即拨打 120</a>'
        : '') +
    '</div>';

  /* 已选症状 */
  document.getElementById('selrow').innerHTML = [...selected]
    .map(id => '<span>' + SYMPTOMS[id].label + '</span>').join('');

  /* 结果列表 */
  const list = document.getElementById('list');
  const hintHtml = '<p class="hint">按症状吻合程度排序。<b>“匹配度”只表示与你所选症状的吻合程度，不代表真实患病概率</b>，同一种表现可能对应多种情况，最终判断需要医生结合查体与检查。</p>';

  if (flags.length && results.length){
    /* 存在危险信号时，把“其他可能情况”收进折叠区，避免与急症提示冲突 */
    list.innerHTML =
      '<details class="morebox">' +
        '<summary>仍要查看其他可能情况（仅供参考）</summary>' +
        '<div class="morebody">' +
          '<p class="hint">排在前面不代表更可能，<b>更不能用来排除心梗、卒中、肺栓塞等急症</b>。请不要因为这里的排名而推迟就医。</p>' +
          results.map((c, i) => renderCondition(c, i, false)).join('') +
        '</div>' +
      '</details>';
  } else if (!results.length){
    if (flags.length){
      /* 急诊横幅已经说明一切，不再重复一张空状态卡 */
      list.innerHTML = '';
    } else {
      list.innerHTML =
        '<div class="empty card fade">' +
          '<div class="big">没有匹配到足够接近的情况</div>' +
          '<p>你选择的症状组合比较复杂或不够典型。建议补充更多症状后重试，或直接到医院让医生面诊。</p>' +
        '</div>';
    }
  } else {
    list.innerHTML = hintHtml + results.map((c, i) => renderCondition(c, i)).join('');
  }

  document.getElementById('intake').classList.add('hidden');
  document.getElementById('notice').classList.add('hidden');
  document.getElementById('triage').classList.add('hidden');
  document.getElementById('results').classList.remove('hidden');

  let shareable = false;
  try {
    history.replaceState(null, '', '#s=' + encodeURIComponent([...selected].join(',')));
    shareable = true;
  } catch (e) { /* file:// 等环境可能不允许，忽略 */ }
  document.getElementById('shareHint').classList.toggle('hidden', !shareable);

  window.scrollTo({top: 0, behavior: 'smooth'});
}

function renderCondition(c, i, openFirst){
  const pct = Math.round(c.score * 100);
  const [grade, gradeCls] = gradeOf(c.score);
  const matched = c.matched.map(id => '<span class="m">' + SYMPTOMS[id].label + '</span>').join('');

  const care = c.care.map(t => '<li>' + t + '</li>').join('');
  const meds = c.meds.map(m => '<li><b>' + m.n + '</b><span>' + m.note + '</span></li>').join('');
  const isOpen = openFirst !== false && i === 0;

  return '' +
  '<details class="cond fade"' + (isOpen ? ' open' : '') + ' style="animation-delay:' + (i * 45) + 'ms">' +
    '<summary>' +
      '<span class="rank">' + (i + 1) + '</span>' +
      '<div>' +
        '<div class="cname">' + c.name + '</div>' +
        '<div class="ctags">' +
          '<span>' + c.dept + '</span>' +
          '<span class="' + gradeCls + '">' + grade + '</span>' +
          (c.tag ? '<span>' + c.tag + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="matchbox">' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<b>' + pct + '%</b>' +
      '</div>' +
      '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
    '</summary>' +
    '<div class="cbody">' +
      '<p class="sum">' + c.summary + '</p>' +
      '<div class="mrow"><span class="k">你提到的症状：</span>' + matched + '</div>' +
      '<div class="cols">' +
        '<div class="block"><h4>自我照护</h4><ul>' + care + '</ul></div>' +
        '<div class="block"><h4>常用药物（通用名）</h4><ul class="meds">' + meds + '</ul></div>' +
      '</div>' +
      '<div class="warn"><b>何时就医</b>' + c.see + '</div>' +
    '</div>' +
  '</details>';
}

if (typeof document !== 'undefined'){
  document.addEventListener('DOMContentLoaded', init);
}
if (typeof module !== 'undefined' && module.exports){
  module.exports = { SYMPTOMS, SYMPTOM_IDS, GROUPS, CONDITIONS, RED_FLAGS, PRESETS, flagsFor, scoreConditions, gradeOf };
}
