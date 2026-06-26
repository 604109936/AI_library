// 产品视角文档生成器（PM 用，大白话、无代码）：一份内容 → 两个 HTML
// 三级颗粒度：底部 Tab → 功能模块 → 功能点；每个功能点含：描述 + 背后运作逻辑 + 分步验证步骤 + 应看到。
//   01_功能清单.html  —— 描述 + 运作逻辑（深度理解）
//   02_验收清单.html  —— 描述 + 运作逻辑 + 验证步骤 + 应看到 + 完成/未完成 + 备注（深度验收）
import fs from "fs";
import path from "path";
const DATE = "2026-06-26";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// n=名称 d=描述 lg=背后运作逻辑(大白话) st=验证步骤(数组) e=应看到(预期)
const f = (n, d, lg, st, e) => ({ n, d, lg, st, e });

const TABS = [
  {
    key: "chat", tab: "智学", glyph: "智", accent: "#4a7359", soft: "#e7f0e8",
    sub: "AI 读书伙伴「小涤」", desc: "像聊微信一样和 AI 对话，帮你荐书、答疑、解读原文。不登录也能用，登录后更懂你。",
    modules: [
      { name: "对话与回答", features: [
        f("逐字流式回答", "提问后回答一个字一个字连续蹦出来，像真人打字。",
          "你的问题发到后台，后台连大模型边生成边往回传；前端用「追赶打字机」平滑显示（落后越多追越快）。切到后台的标签页会直接整段显示，避免回来还在慢慢爬。",
          ["进入「智学」，输入“推荐一本关于成长的书”发送", "盯着回答出现的过程", "把页面切到后台几秒再切回来"],
          "回答连续逐字出现、不卡顿、不空白；切回来是完整回答而非半截。"),
        f("智能等待提示", "它在查书/思考时给“在翻书/在帮你查”的人话提示。",
          "后台执行查书等动作时会发来状态，前端用水波纹文字呈现；大模型的思考过程也会被提炼成≤20字的人话提示，没有提示时本地句池每隔几秒换一句兜底。",
          ["问一个需要查书的问题（如“《某书》第二章讲了什么”）", "观察回答出现前的等待区"],
          "等待期出现“翻开《某书》/在网上帮你查”等人话提示，不是干转圈。"),
        f("回答排版与外链", "回答有标题、列表、加粗等排版；链接点开新网页。",
          "回答按 Markdown 渲染成排版；为了手机好读，禁止输出表格（万一漏出会降级成行列表）；正文里的链接强制新开页、危险链接被过滤。",
          ["问一个回答较长、可能带分点/链接的问题", "看排版", "若有链接点一下"],
          "排版清晰好读、无挤爆的表格；链接在新页打开，不顶掉当前对话。"),
      ]},
      { name: "智能卡片", features: [
        f("推荐书卡片", "荐书时给可点的书封卡片，读过的书标“已读完/在读”。",
          "AI 决定荐书时，后台会先校验这些书在馆里真实存在（最多5本）再返回；前端把书解析成完整书目，并结合你本地的收藏/进度叠加“懂你”徽标。",
          ["问“给我推荐一本书”", "看回答里的横排书封卡片", "点其中一张卡"],
          "出现可横滑的书封卡片；读过的书卡上有“已读完/在读N%/在书架”小标；点击进入该书详情。"),
        f("原文出处卡片", "答疑时给依据的章节卡片，点一下跳到原文。",
          "AI 细读过章节作答后，后台一次性把书名/章题/开头摘要打包回来（前端零查询直接显示），并和你的阅读进度缝合标注“你正读到这里/你读过这章”。",
          ["问某本书某一章的内容或观点", "看回答下方的“依据原文N处”卡片", "点一张卡"],
          "出现章节出处卡（可能标注你的进度），点击跳到对应章原文。"),
        f("联网来源卡片", "时效问题联网查并附来源链接。",
          "只有当问题带时效性（最新/近况/新闻）且超出馆藏时，后台才去联网搜，取前几条；非时效问题被系统规则限制不联网。",
          ["问“最近/最新/近况”类问题（如“最近有什么科技新闻”）", "看是否出现来源卡", "再问一个非时效问题对比"],
          "时效问题出现“来源N处”外链卡（带域名/日期、新开页）；非时效问题不会乱联网。"),
        f("卡片出现在正确位置", "卡片插在“理由之后、后话之前”的合适位置。",
          "卡片不是堆在末尾——后台在回答的对应位置埋了占位记号，打字机走到那儿卡片才自然出现，顺序和 AI 说话的节奏一致；老消息无记号时回退到末尾，绝不丢卡。",
          ["问一个会“先说理由→给书卡→再补一句”的问题", "观察卡片出现的位置"],
          "卡片出现在它该出现的话语位置（理由之后、后话之前），不突兀、不丢失。"),
      ]},
      { name: "输入", features: [
        f("文字输入与发送", "输入框可多行、有字数上限、回车发送。",
          "输入框随内容自动长高（封顶后内部滚动）；限 500 字超出提示；用输入法打中文时按回车是“选词”不会误发。",
          ["在输入框打多行文字", "试着粘超过 500 字", "用中文输入法打字时按回车（候选未上屏时）", "正常回车发送"],
          "可多行；超字数有提示并截断；选词时回车不发送；正常回车能发出。"),
        f("语音输入", "长按输入框说话转文字。",
          "长按 0.35 秒触发，用浏览器自带的语音识别实时转文字，松手把文字填回输入框让你确认再发；上滑超过一定距离取消。识别不依赖后台 AI。",
          ["长按输入框约半秒，开始说一句话", "说话时看实时识别文字和音量波形", "松手", "另试：长按后上滑再松手"],
          "录音浮层有实时文字+音量波形；松手把文字填进输入框可改可删；上滑松手则取消。"),
      ]},
      { name: "个性化与记忆", features: [
        f("认得你的近况", "登录后欢迎语喊昵称、点出你在读的书。",
          "纯前端用你本地已有的数据（昵称/在读/已读时长）拼欢迎语，不花 AI 额度；游客则用真实馆藏书名拼。",
          ["登录后进入「智学」、确保是空白对话（没聊过）", "看顶部欢迎区"],
          "问候喊你昵称，并说出你在读的书/已读时长，下面有“继续读/给我荐一本”等按钮。"),
        f("专属示例问题", "按你的数据给可点的示例问题（游客用真实馆藏）。",
          "示例问题由你的在读/收藏/笔记动态生成（登录），或用真实书名拼（游客）——点哪条就直接发那条。",
          ["看欢迎区下方的示例问题", "点其中一条"],
          "示例问题贴合你的阅读（或真实馆藏）；点一下就开聊。"),
        f("越聊越懂你", "记住你的阅读偏好、近况，跨对话也记得。",
          "每聊几轮，后台悄悄让 AI 把对话里关于“你是谁/爱读什么/近期关注”等提炼成长期记忆存起来，下次自动注入，让小涤“记得你”。",
          ["告诉它你的阅读偏好（如“我喜欢偏轻松的成长类”）", "再聊几轮别的", "过一会问“根据我的偏好推荐一本”或重开对话再问"],
          "它能延续你说过的偏好来回答/推荐，不会重复问、不像第一次见你。"),
        f("长对话不忘事", "对话很长也不丢前面聊过的内容。",
          "对话太长时后台会把较早的内容压成摘要保存（原文也留着），请求时带上摘要+最近若干轮，保证既不超长又不丢上下文。",
          ["连续聊很多轮（十几轮以上）", "然后问“我们前面聊过的那本书/那个结论是什么”"],
          "仍记得早先讨论过的书/结论/你的偏好，不会“失忆”。"),
      ]},
      { name: "回答操作", features: [
        f("点赞 / 点踩 + 原因", "对回答点赞或点踩并选原因。",
          "点踩弹反馈浮层选标签（推荐偏差/答疑有误/解读没用/其它可填）；反馈随这条消息存进云端，留痕。",
          ["对一条回答点踩", "在弹层里选一个原因标签，或填“其它”", "看是否留痕"],
          "能选标签并留备注；踩过的消息常驻“已反馈·原因”小标，可再点修改。"),
        f("重新生成", "对回答不满意换个角度再答（带上踩的原因）。",
          "点重新生成会删掉旧回答、把你踩的原因作为一次性提示喂回 AI，让它换角度重答——反馈当场可感知地生效。",
          ["对一条回答点踩并选原因", "点“重新生成”", "对比新旧回答"],
          "生成新的、和原来不同角度的回答，能体现你刚才的不满意点。"),
        f("复制回答", "一键复制回答文本。",
          "复制的是给人看的纯文本（去掉卡片占位记号）；非安全环境（手机经局域网）也有兜底复制。",
          ["点回答下方的复制按钮", "去输入框粘贴看看"],
          "提示“已复制”；粘贴出的是干净的回答文字。"),
        f("停止生成", "回答太长随时停。",
          "点停止会中断后台请求，已经流出来的文字和卡片保留为完成态，不会变成报错。",
          ["问一个会出长答案的问题", "回答进行中点“停止生成”"],
          "立刻停下，已出的内容/卡片保留，不报错。"),
      ]},
      { name: "会话同步", features: [
        f("对话保存与跨设备同步", "对话自动存云端，换设备也接得上。",
          "登录后每答完一轮，对话整段同步到云端（你的专属记录）；换设备登录会先把云端历史拉到本地再接着聊。",
          ["登录后聊几句", "换一个设备/浏览器登录同一账号", "进入「智学」"],
          "之前的对话还在、能接着聊，不会丢。"),
        f("切 Tab / 重登仍在", "切去别的 Tab 再回来、或重新登录，对话不丢。",
          "切 Tab 时画面存在内存缓存里（按账号隔离）；重登时云端历史会和本地按消息去重合并，不重复不丢。",
          ["聊几句", "切到「泡馆」再切回「智学」", "再试：退出登录后重新登录进智学"],
          "对话内容仍在、顺序正常，不会清空或重复。"),
        f("回看与回到最新", "向上翻看历史时停止自动滚动，并给“回到最新”。",
          "回答输出时默认自动贴底跟随；一旦你上滑回看，就停止自动滚（不强拽你回去），并浮出“回到最新”按钮。",
          ["发一个长问题，回答输出中向上滑去看前面", "观察是否被强行拽回底部", "点“回到最新”"],
          "上滑时不被拽回；出现“回到最新”按钮，点了平滑回到底部。"),
        f("体验账号不串档", "体验账号是大家共用，但各人的对话不会互相看到。",
          "体验账号是全体游客共用的同一个账号，所以它的对话被设成“只读云端、绝不回写”——谁聊的都不会存进共享记录被下一个人看到。",
          ["用“体验账号”登录，在智学聊几句", "退出（或换个浏览器/无痕窗口）", "再用“体验账号”登录进智学"],
          "看不到上一个人聊的内容（隐私不串档）。"),
      ]},
    ],
  },
  {
    key: "library", tab: "泡馆", glyph: "泡", accent: "#b08d57", soft: "#f4ecdb",
    sub: "分类书库 + 文字/音频/视频阅读", desc: "逛书库、读书、听书、看视频解读，划线写笔记、写书评，都在这里。",
    modules: [
      { name: "泡馆首页", features: [
        f("分类网格", "首页按分类入口进入。",
          "首页从书库实时统计每个分类有多少本书并展示入口（真实数据）。",
          ["打开「泡馆」", "看分类区", "点一个分类"],
          "各分类入口正常，点击进入对应分类列表。"),
        f("每类最新 Banner", "每个分类最新入库的一本作 Banner。",
          "取每个分类“最近入库”的一本做 Banner 轮播。",
          ["看首页 Banner 区", "点一个 Banner"],
          "展示每类最新书，点击进入该书详情。"),
        f("继续阅读", "首页给你在读的书续读入口。",
          "登录且有在读记录时，首页显示续读卡，直接接着上次读。",
          ["确保有一本在读的书（先去读一点）", "回到泡馆首页", "点“继续阅读”"],
          "出现“继续阅读”，点击直接续到上次位置。"),
        f("热门好书", "首页推荐热门好书列表。",
          "按一定规则排出热门好书；你已读完的会被过滤掉，不再占位。",
          ["看首页“热门好书”", "（登录并读完几本后再看）"],
          "列出热门好书；已读完的不再出现在这里。"),
      ]},
      { name: "分类书库页", features: [
        f("进入分类看全部", "某分类下全部书。",
          "进入分类按入库时间倒序列出该类全部书，分页加载。",
          ["点一个分类进入"],
          "列出该分类的书。"),
        f("类型筛选", "音视频 / 文字稿 切换。",
          "顶部切“音视频/文字稿”，列表按书是否有视频/音频/文字过滤。",
          ["在分类页点“音视频”再点“文字稿”"],
          "列表随筛选变化，分别只显对应类型的书。"),
        f("已读 / 未读状态", "书上标已读/未读。",
          "根据你的真实阅读记录给每本书算“已读/未读”标。",
          ["登录后读完一本、另留一本没读", "回到分类列表看这两本的状态标"],
          "读过的标“已读”，没读的标“未读”，与实际一致。"),
        f("无限滚动加载", "往下滚自动加载更多。",
          "滚到接近底部自动拉下一页，用游标分页保证不重复不漏（即使入库时间相同也稳定）。",
          ["在一个书多的分类里一直往下滑"],
          "自动续上更多、不重复、不漏、不跳。"),
      ]},
      { name: "搜索", features: [
        f("搜书名/作者/标签", "关键词搜书。",
          "按书名/作者/标签模糊匹配，输入有防抖（停下才搜），大小写不敏感。",
          ["点搜索，输入一个书名或作者关键词", "再用小写英文试一次"],
          "出相关结果；英文大小写都能搜到。"),
        f("最近搜过", "记住最近搜索词。",
          "真正“停下看了结果”的词才记进最近搜过（中途路过的前缀词不记），最多留几条。",
          ["搜几个不同的词，每次停下看结果", "回到搜索落地页看“最近搜过”"],
          "有刚搜的词，可点重搜、可单独删除。"),
        f("热门搜索", "展示热门搜索词。",
          "热门词来自全站搜索热度（且仍能搜到结果），冷启动时用真实书名/标签补足，保证不空。",
          ["看搜索落地页“热门搜索”", "点一个热门词"],
          "有热门词；点了必有结果。"),
        f("返回保留搜索词与结果", "搜了点进书再返回，词和结果还在。",
          "搜索词会同步到网址里，返回时从网址恢复——所以点进一本书再返回，搜索词和结果列表都还原。",
          ["搜一个词出结果", "点进其中一本书", "点返回回到搜索页"],
          "搜索词和结果列表都还在，不用重新打字。"),
      ]},
      { name: "书籍详情页", features: [
        f("简介/标签/字数", "封面氛围图、简介、标签、字数。",
          "展示书的封面氛围图、可展开的简介、标签、字数等；缺封面时用兜底美术图。",
          ["点开任意一本书", "点简介的“展开全文”"],
          "信息完整，简介能展开/收起。"),
        f("章节目录", "文字书展示章节清单。",
          "文字书拉取轻量章节目录（不含正文，省流量），点章进入阅读。",
          ["打开一本文字书，看“文字全文”区的章节列表", "点一章"],
          "列出章节，点击进入该章阅读。"),
        f("收藏 / 取消", "收藏这本书。",
          "点收藏本地立刻变色（不等网络），后台异步写云端；登录数据加载完成前按钮给中性占位，避免“已收藏的书先显示收藏再跳”。",
          ["登录后打开一本未收藏的书，点“收藏”", "去「我的-收藏」确认", "再打开一本已收藏的书，注意刚进页面的按钮"],
          "点击立即变“已收藏”，我的收藏里能看到；已收藏的书刚进页面不会先闪“收藏”再跳。"),
        f("阅读入口", "开始/继续阅读、播放音视频。",
          "底部按钮按书的类型变：文字书显“开始/继续阅读”，纯音视频书显“播放”。",
          ["分别打开一本文字书和一本音视频书", "看底部按钮"],
          "文字书显“开始/继续阅读”；音视频书显“播放视频/音频”。"),
      ]},
      { name: "文字阅读器", features: [
        f("正文阅读", "正文排版清晰。",
          "正文按 Markdown 渲染（标题/加粗/列表等），中文标点处的加粗也能正确解析。",
          ["进入阅读器，浏览正文"],
          "正文字体/行距/排版舒适、无乱码。"),
        f("目录与翻章", "目录抽屉 + 上一章/下一章。",
          "目录抽屉打开时自动把当前章滚到视野中央；切章会同步网址（刷新落在当前章）。",
          ["点目录看抽屉、点一章跳转", "用“上一章/下一章”翻", "翻到某章后刷新页面"],
          "能切章；目录定位当前章；刷新后仍在当前章。"),
        f("进度显示", "本章进度 + 全书进度。",
          "进度 =（已读完章数 + 当前章滚动比例）÷ 总章数，章内滚动也平滑前进，全部读完才 100%。",
          ["读时看底部“本章 X% · 全书 Y%”", "往下滚动观察变化"],
          "本章/全书百分比随滚动平滑前进，数值合理。"),
        f("续读回原位", "回到上次读到的精确位置。",
          "阅读时后台持续记录“第几章+章内滚动百分比”（本机精确存一份、云端存全书进度）；续读优先用本机精确位置，没有就用云端进度反推。",
          ["打开文字书读到第3章、往下滚到一半", "退出回详情页（或切到别的Tab）", "再点“继续阅读”"],
          "回到第3章、滚动停在你离开的那个位置（不是章首、不是开头）。"),
        f("沉浸模式", "点正文中部隐藏顶/底栏。",
          "点正文纵向中间区域切换顶/底栏显隐；点在划线/按钮/有选区时不触发。切章自动恢复显示。",
          ["点正文中间空白处", "再点一次"],
          "顶栏底栏隐藏（顶部留一条细进度线），再点恢复。"),
        f("阅读设置", "字号/背景/亮度可调。",
          "字号/背景色/亮度本地持久化，下次进来记得；深色底高亮配色会自动适配。",
          ["点设置，调字号、换背景、拉亮度", "退出再进阅读器"],
          "三项实时生效；再进来仍是你设的偏好。"),
        f("读毕仪式", "整本读完盖“读毕”印 + 写书评入口。",
          "读到最后一章且该章读毕时，章末出现“读毕”印章卡和写书评/回书页入口。",
          ["把一本书所有章节读完（滚到底或读毕）"],
          "最后出现“读毕”印章 + “写一篇书评”入口。"),
      ]},
      { name: "划线与笔记", features: [
        f("划线高亮", "选中正文打高亮，多色。",
          "选中文字后用“真实摘录+就近位置”定位，跨段落、跨粗体也能把选中文字完整标记；落库后刷新重标，幂等不丢。",
          ["长按选中一段文字（试试跨段落选）", "选一个颜色", "刷新页面"],
          "选中的文字被“完整”标色（跨段也完整）；刷新后高亮仍在。"),
        f("写笔记", "对划线写想法。",
          "选中文字点“笔记”写想法保存；和已有划线重叠会自动“并集合并”（保留想法、用新色）而不是拒绝。",
          ["选中文字→点“笔记”→写一句→保存", "去「我的-笔记」看"],
          "保存成功；我的笔记里能看到这条。"),
        f("换色 / 删除划线", "点已有划线换色或删除。",
          "点正文里的高亮弹浮层，可换色、写/改想法、删除；删除给撤销机会。",
          ["点正文里一处高亮", "试换色、写想法、删除", "删除后点“撤销”"],
          "可换颜色/写想法/删除；删了能撤销回来。"),
      ]},
      { name: "音频播放器", features: [
        f("播放 / 暂停", "口播音频播放控制。",
          "真实播放才开始记账（光打开不点不算）；切走/退出会自动停声并释放，不在后台偷偷响。",
          ["详情页切到“音频”，点播放、再暂停", "播放中切到别的页面"],
          "能播能停；切走后声音停止，不在后台继续响。"),
        f("±15 秒与倍速", "后退/快进 15 秒、调倍速。",
          "±15 秒和拖动一样是“人为跳变”，不会被算成真实收听；倍速 0.75~2 倍。",
          ["点后退/快进 15 秒", "切几个倍速"],
          "前后跳 15 秒；倍速即时生效。"),
        f("锁屏控制", "锁屏/控制中心可控。",
          "接入系统媒体控制：锁屏/控制中心显示书名封面，可播放/暂停/±15 秒。",
          ["播放音频后锁屏（或看控制中心）"],
          "锁屏显示书名封面，并能暂停/播放/±15 秒。"),
        f("续播位置", "下次从上次位置接着听。",
          "收听位置存云端（按书），音频/视频/乱翻共享同一位置（口播与视频内容一致）。",
          ["听到中段退出", "再次进入该书音频"],
          "从上次位置接着播。"),
      ]},
      { name: "视频播放器", features: [
        f("播放 / 暂停", "竖屏视频播放控制。",
          "未点播放时一直显示书封不跳视频帧；切走/卸载停声并释放解码资源。",
          ["详情页播放视频、再暂停", "播放中返回上一页"],
          "能播能停；返回后视频声音停止。"),
        f("竖屏全屏", "进入/退出全屏。",
          "自绘竖屏全屏（锁滚动+接管返回手势），返回手势只退全屏不退页面。",
          ["点全屏按钮进入", "用系统返回手势/退出按钮退出"],
          "竖屏全屏正常；返回手势退全屏而不是退出整页。"),
        f("倍速", "调播放倍速。", "倍速 0.75~2 倍即时切换。",
          ["切几个倍速"], "倍速即时生效。"),
        f("拖动进度", "拖进度条定位。",
          "拖动时只移滑块、松手才真正跳，避免和播放进度抢值导致卡顿。",
          ["拖动进度条到某处松手"], "能定位，松手到位、不抖。"),
        f("续播位置", "下次从上次位置接着看（与音频/乱翻共享）。",
          "视频位置和音频/乱翻共享同一个续播点（内容一致）；详情页看到哪，乱翻滑到这本也从哪播。",
          ["看到中段退出", "再次进入该书视频"],
          "从上次位置接着播。"),
      ]},
      { name: "书评", features: [
        f("写书评", "评分 + 写内容。",
          "书评按“每书每人一条”入库；写入失败会提示。",
          ["详情页点“写书评”，打分+写内容+提交"],
          "提交后详情页“我的评价”显示你的书评。"),
        f("更新书评", "改自己的书评。",
          "再次进入是“更新”，覆盖你那一条（不会变成两条）。",
          ["对已写过书评的书点“更新书评”，改内容提交"],
          "内容更新成功，仍是一条。"),
        f("我的评价展示", "详情页只显你自己那条。",
          "本版只展示“我的评价”一条（他人书评只存数据不展示）；头像昵称取当前账号实时值。",
          ["看写过书评的书的详情页“我的评价”"],
          "展示你本人的书评，头像/昵称为当前账号。"),
      ]},
    ],
  },
  {
    key: "flip", tab: "乱翻", glyph: "乱", accent: "#b04a3c", soft: "#f6e6e2",
    sub: "竖滑视频流（像刷抖音）", desc: "上下滑发现好书的视频解读，双击收藏、随手写书评。",
    modules: [
      { name: "视频流", features: [
        f("竖滑切条", "上下滑一屏一本书。",
          "整屏滚动吸附（snap）一屏一条；只用 3 个视频播放器轮流承载当前条±1，省解码、能撑很多本。",
          ["打开「乱翻」，上下滑几条"],
          "一屏一条，滑动跟手、不卡。"),
        f("自动播放", "滑到哪播哪，划走自动停。",
          "落到哪条就播哪条、暂停其余；带声被浏览器拦时自动静音兜底继续播（不会卡死）。",
          ["停在某条看是否自动播", "快速划到下一条"],
          "当前条自动播放，划走自动暂停，切换不串台。"),
        f("无限续拉", "一直滑自动续更多。",
          "快滑到接近末尾自动续拉一批；续拉用更均匀的打乱，且不会让“上一轮最后一本”紧挨“下一轮第一本”重复。",
          ["一直往下滑，越过一轮"],
          "自动续上更多、不突然没了、不紧挨重复同一本。"),
        f("离开返回保持位置", "去别处再回乱翻，停在原位。",
          "离开时把当前书单和所在位置缓存（按账号隔离），返回时恢复到原来那条。",
          ["滑到第5条左右", "点进详情/去写书评", "返回乱翻"],
          "回到刚才那条、那个画面，不从头开始。"),
      ]},
      { name: "播放控制", features: [
        f("声音开关", "静音/外放，含被拦兜底提示。",
          "喇叭只管声音、不打断“你主动暂停”；首次被浏览器拦静音时提示“轻点开启声音”，4 秒自隐。",
          ["点右上喇叭切静音/外放", "首次进入若是静音，看是否有提示"],
          "声音可切；被拦时出现“轻点开启声音”提示，点喇叭即恢复。"),
        f("进度条拖动", "拖底部进度条定位。",
          "底部细线随播放推进；按下变粗可拖动，拖时显示“当前/总时长”，松手才跳。",
          ["拖动底部进度条到某处松手"],
          "能定位、拖时显示时间、松手到位。"),
        f("续播与详情页共享(不被污染)", "乱翻↔详情页进度互通；但拖进度/视频循环不会弄乱。",
          "乱翻和详情页共享同一个续播位置；但只有“自然往前播”才更新位置——视频循环回开头、或你拖进度条这种人为跳变都不写，所以不会把续播点弄回 0 或乱跳。",
          ["详情页把某书看到中段→进乱翻滑到这本（或反过来）", "让乱翻视频循环回开头、或拖一下进度条", "退回详情页看续播点"],
          "从同一进度接着播；循环回开头/拖进度后，续播点不被打回开头。"),
        f("坏视频转图文", "视频放不出给图文出路。",
          "视频源坏/弱网放不出时，给“重试”和“看图文详情”出路，而不是一直转圈。",
          ["遇到一条无法播放的视频（或弱网）"],
          "出现“重试”和“看图文详情”，能转去看图文。"),
      ]},
      { name: "互动", features: [
        f("双击收藏", "双击屏幕收藏，有心形动画。",
          "双击=收藏（已收藏则只放动画不取消），单击=播放/暂停；二者用延时区分、快滑切条时不误触。",
          ["双击视频画面", "再单击一次画面"],
          "双击：心形动画爆开并收藏；单击：播放/暂停。"),
        f("右侧心形收藏", "点右侧心收藏。",
          "右侧心形按钮收藏/取消并 toast 提示，收藏时心形弹跳。",
          ["点右侧心形"],
          "收藏/取消并提示，图标状态正确。"),
        f("写书评入口", "随手写书评。", "点右侧评论图标进入该书写书评页。",
          ["点右侧评论图标"], "进入写书评页。"),
      ]},
      { name: "个性化", features: [
        f("每日个性化书单", "结合你偏好每天更新推送。",
          "每天凌晨后台按你的收藏/已读/笔记/对话偏好为你排一份书单（排除已读完、在读优先）；新用户/游客回退到最新入库的视频书。",
          ["登录用户每天来逛乱翻", "对比已读完的书是否还出现"],
          "推的书贴合你偏好；已读完的不再推。"),
      ]},
    ],
  },
  {
    key: "me", tab: "我的", glyph: "我", accent: "#4f7a8c", soft: "#e4eef2",
    sub: "个人中心", desc: "登录注册、个人资料、收藏/笔记/书评/历史、设置与主题，都在这里。",
    modules: [
      { name: "个人中心首页", features: [
        f("资料展示", "头像、昵称、简介。",
          "登录就显示资料（不等整条加载链），未就绪时给骨架，确认未登录才显登录入口。",
          ["登录后打开「我的」看头部"],
          "展示当前账号头像/昵称/简介；不会先闪“登录/注册”再跳。"),
        f("数据统计卡", "阅读时长/已读/进行中/收藏。",
          "四个数等数据真正加载完才显示真值，否则显“—”，避免登录瞬间先闪“0”再跳。已读/进行中按“书”跨大类去重统计。",
          ["登录瞬间盯着四个卡", "对比“已读”数字"],
          "刚登录不先闪“0/0/0/0”再跳；数字真实。"),
        f("菜单入口", "我的书评/笔记/设置/关于。", "菜单项跳对应页；需登录的项未登录会弹登录。",
          ["逐个点菜单项"], "各入口可进（需登录的会先弹登录）。"),
        f("拉绳台灯主题", "拉绳切日/夜主题（彩蛋）。",
          "右上角是一盏可拖拽拉绳的台灯，下拉松手切换日间/夜间，主题本地持久化。",
          ["拉一下右上角台灯拉绳", "看全站是否变色"],
          "日间/夜间切换，所有页面跟着变，刷新仍保持。"),
      ]},
      { name: "编辑资料", features: [
        f("改昵称/简介", "修改昵称和简介。",
          "保存先本地乐观更新、再写云端；写失败会回滚并提示“保存失败”，不会假成功。",
          ["点“编辑资料”改昵称和简介，保存"],
          "保存成功并生效；失败有明确提示。"),
        f("换 / 上传头像", "换预设或上传头像。",
          "可选预设或上传图片到你的专属头像位；注销账号时这些头像也会被清。",
          ["在编辑资料里换一个预设头像或上传一张", "保存"],
          "头像更新成功并显示。"),
      ]},
      { name: "我的收藏", features: [
        f("收藏列表", "看收藏的书。",
          "把你收藏的书 id 解析成书目列出。",
          ["点“收藏”卡进入", "点其中一本"],
          "列出收藏的书，可进入详情。"),
      ]},
      { name: "我的笔记", features: [
        f("笔记列表", "看所有笔记。", "按时间列出你的全部划线/笔记。",
          ["点“我的笔记”"], "列出笔记。"),
        f("跳回原文", "点笔记跳回书里位置。",
          "点笔记深链到阅读器并定位到该划线；即使该划线被别的划线完全覆盖（无独立标记），也会按摘录位置滚过去，不会点进去没反应。",
          ["点一条笔记", "（再找一条和别处重叠的划线点）"],
          "跳回书里对应位置；不会“点进去无反应”。"),
      ]},
      { name: "我的书评", features: [
        f("书评列表", "看写过的书评。", "列出你写过的全部书评。",
          ["点“我的书评”"], "列出你的书评。"),
      ]},
      { name: "阅读历史", features: [
        f("已读 / 进行中视图", "按已读/进行中看。",
          "从数据卡进入会带上“有记录的大类”，避免点进去因默认筛选而空。",
          ["从“已读”或“进行中”卡点进去"],
          "进入对应列表，不会一进去就空。"),
        f("数字与列表一致", "卡上数字和列表条数对得上。",
          "已读/进行中按“书”跨大类去重统计；点进去的列表也按书去重合并全部大类，让数字=条数。",
          ["看“我的”卡上“已读 N”", "点进去数列表条数", "（造一本既听音频又读文字的书再对比）"],
          "卡片数字 = 列表条数，对得上。"),
        f("删除 + 撤销", "删历史可撤销。",
          "单击删除给 4 秒撤销窗口；列表按时间倒序渲染，撤销恢复的旧记录不会错误置顶。",
          ["删一条历史→点“撤销”", "观察恢复后的位置"],
          "删除有“撤销”；撤回后顺序正常、不乱跳到最前。"),
      ]},
      { name: "设置", features: [
        f("修改密码", "改登录密码（体验账号不可）。",
          "本人账号可改密；共享体验账号被前后端双重拦截，不许改。",
          ["设置里改密码", "（用体验账号试一次）"],
          "本人账号能改；体验账号被拦提示不可改。"),
        f("阅读偏好", "默认阅读方式等偏好。", "阅读相关偏好本地持久化。",
          ["设置里调阅读偏好后再进阅读器"], "偏好生效。"),
        f("主题深浅色", "浅色/深色切换。", "与拉绳台灯同一个开关，本地持久化、全站生效。",
          ["设置里切主题"], "全站浅/深色切换。"),
        f("意见反馈", "提交意见反馈。", "提供反馈入口收集你的意见。",
          ["设置里找到反馈入口并提交一条"], "能提交反馈。"),
        f("退出登录", "退出回游客态。",
          "退出会清本地用户数据与搜索历史（对话云端永久保留），防下一个人/游客看到上一账号痕迹。",
          ["点退出登录", "看收藏/历史/搜索历史"],
          "回游客态，看不到上一账号的任何数据。"),
        f("注销账号", "本人可注销清数据（体验账号不可）。",
          "本人注销会删账号并级联清除你的数据+头像；身份核验不通过时绝不误删；体验账号不许注销。",
          ["（谨慎）本人账号走注销流程", "（用体验账号试一次）"],
          "本人账号可注销并清数据；体验账号提示不可注销。"),
      ]},
      { name: "关于 / 法律", features: [
        f("关于", "关于本应用。", "静态信息页。", ["点“关于”"], "正常打开。"),
        f("用户协议", "用户协议页。", "静态条款页。", ["打开用户协议"], "正常展示。"),
        f("隐私政策", "隐私政策页。", "静态条款页。", ["打开隐私政策"], "正常展示。"),
      ]},
    ],
  },
  {
    key: "global", tab: "全站通用", glyph: "通", accent: "#6b6459", soft: "#ece7db",
    sub: "贯穿所有页面的体验", desc: "不属于某一个 Tab、但每个页面都该正常的通用体验。",
    modules: [
      { name: "启动与导航", features: [
        f("开屏启动画面", "进入有开屏画面，可跳过。",
          "开屏停留约 3 秒，期间预取首页数据做加载缓冲，到时自动进泡馆，也可点跳过。",
          ["冷启动打开 App", "看开屏，或点“跳过”"],
          "显示开屏（约 3 秒）后进泡馆；可跳过立即进入。"),
        f("底部 4 Tab 切换", "智学/泡馆/乱翻/我的 四个 Tab。",
          "底部导航只在四个主页面出现，二级页不显示；当前 Tab 高亮。",
          ["依次点底部四个 Tab", "进入某二级页看底部"],
          "四个 Tab 都能切、当前高亮；二级页不显示底部栏。"),
        f("二级返回不跳出", "返回箭头回馆内。",
          "返回用“本次会话内是否在 App 内导航过”判断：站内有可退处才返回，否则（从外链/分享直接进）去兜底页，不会弹出 App。",
          ["从外部链接/分享直接打开一本书", "点左上返回箭头"],
          "回到馆内（如泡馆），不跳出 App 到来源网站。"),
        f("页面转场", "页面切换有平滑动画。", "页面进入有淡入+轻微上移的统一转场。",
          ["在各页之间跳转"], "切换有平滑过渡，不生硬。"),
      ]},
      { name: "登录与守卫", features: [
        f("登录 / 注册弹层", "邮箱密码登录注册。",
          "底部弹出登录抽屉；英文报错转成中文；注册昵称随注册写入，邮箱已注册会提示直接登录。",
          ["点登录，试注册一个新号", "试用已注册邮箱注册", "试错误密码登录"],
          "能注册/登录；各种错误都有中文提示。"),
        f("体验账号一键登录", "无需注册一键体验。",
          "点一下即用共享体验账号登录，免注册体验全部功能。",
          ["点“体验账号一键登录”"],
          "直接进入登录态。"),
        f("未登录拦截自动继续", "点需登录功能弹登录，登录后自动继续。",
          "需登录的操作会被“挂起”，弹登录；登录成功后自动把刚才那步执行掉，不用你再点一次。",
          ["游客点收藏 / 写笔记 / 进“我的”二级页", "在弹出的登录里登录"],
          "弹登录；登录后自动完成你刚才的操作（如收藏自动加上）。"),
        f("游客可逛", "不登录也能用核心功能。",
          "书库浏览、刷乱翻、问智学都对游客开放；只有个性化和“我的”数据需登录。",
          ["不登录，浏览书库 / 刷乱翻 / 问智学"],
          "都能正常用；仅个性化/我的需登录。"),
      ]},
      { name: "健壮性兜底", features: [
        f("出错不白屏", "任何页面出错有中文兜底+重试。",
          "三级错误兜底（页面级/根级/404）都不白屏；崩溃兜底页也带手机视口，文字按钮不会缩成桌面小字。",
          ["正常使用各页面（异常时观察）"],
          "出错显中文“出了点小状况/重试”，不白屏；手机上字/钮大小正常可点。"),
        f("404 页", "访问不存在的页面有提示。",
          "访问不存在地址显示中文 404 + 回首页出路。",
          ["在地址栏打一个不存在的路径打开"],
          "显示 404 中文提示 + 回首页出路。"),
        f("空状态友好", "没数据时有引导。",
          "列表为空时区分“真空态”（给引导）和“网络失败”（给重试），不是一片空白。",
          ["用新账号看收藏 / 笔记 / 历史"],
          "空列表有友好文案 + “去逛逛”入口。"),
        f("不卡死在加载", "首屏/登录态恢复不会一直转圈。",
          "首屏恢复登录态有超时兜底：万一卡住也会放行进入（按未登录处理），不会让全站永久停在“正在打开”。",
          ["刷新各页、弱网下进入受登录保护的页面"],
          "页面正常出来，不会永久卡在“正在打开/骨架”。"),
      ]},
      { name: "适配与基础", features: [
        f("手机安全区适配", "全面屏不被遮挡。",
          "底部栏/输入条计入安全区，顶部计入刘海，视口锁手机真实宽度、禁双指缩放。",
          ["用全面屏手机逛各页面，注意底部和顶部"],
          "底部不被导航条压住，顶部不被刘海挡，按钮不贴边难点。"),
        f("深浅主题全站生效", "切主题所有页面跟着变。",
          "主题切换给整个页面打标记，所有组件都做了深色适配。",
          ["切深色后逐页逛一遍"],
          "全站深/浅一致，无残留亮块/看不清。"),
        f("操作 Toast 提示", "收藏/保存/出错有轻提示。",
          "关键操作给简短中文 toast；同文案不重复堆叠、几秒自动消失。",
          ["做收藏/保存/触发一次错误"],
          "出现简短中文提示（成功/失败），自动消失。"),
        f("添加到主屏(PWA)", "可添加到手机主屏。",
          "支持“添加到主屏幕”独立打开；但目前只有矢量图标、缺多尺寸图标，部分系统主屏图标可能不显示（已知小问题）。",
          ["手机浏览器选“添加到主屏幕”", "从主屏打开"],
          "能添加并独立打开；图标在部分系统可能不显示（属已知小问题，可记未完成）。"),
        f("防刷限流", "短时间狂问会被温和拦一下。",
          "每账号有每分钟/每小时提问上限，超了温和拦一下，防被刷爆 AI 额度（正常节奏不受影响）。",
          ["极短时间内连续大量提问（十几次/分钟以上）"],
          "出现“歇口气，一分钟后接着聊”；正常节奏不被打断。"),
      ]},
    ],
  },
];

const totalFeatures = TABS.reduce((s, t) => s + t.modules.reduce((a, m) => a + m.features.length, 0), 0);

const CSS = `
:root{--paper:#f4efe4;--paper2:#fbf8f1;--card:#fffdf8;--ink:#33302a;--ink2:#6b6459;--ink3:#928a7b;--celadon:#4a7359;--gold:#b08d57;--cinnabar:#b04a3c;--line:#e2d9c6;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Serif SC","Songti SC","Source Han Serif SC",ui-serif,Georgia,serif;line-height:1.7;font-size:15px}
.wrap{max-width:1080px;margin:0 auto;padding:0 18px}
.hero{background:linear-gradient(135deg,#3f6452,#4a7359 60%,#5a8068);color:#f6f2e8;border-bottom:3px solid var(--gold)}
.hero .wrap{padding:34px 18px 26px}
.hero .kicker{letter-spacing:.34em;font-size:12px;opacity:.85;margin:0 0 8px}
.hero h1{margin:0;font-size:28px;font-weight:700;letter-spacing:.03em}
.hero .pos{margin:12px 0 0;max-width:800px;opacity:.95;font-size:14.5px}
.hero .stat{display:flex;gap:24px;margin-top:18px;flex-wrap:wrap}
.hero .stat b{font-size:24px;display:block;font-weight:700}
.hero .stat span{font-size:12px;opacity:.85}
.tabs{position:sticky;top:0;z-index:30;background:rgba(244,239,228,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.tabs .wrap{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 18px}
.tabchip{border:1px solid var(--line);background:var(--paper2);color:var(--ink2);border-radius:20px;padding:6px 13px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.tabchip.active{background:var(--celadon);color:#fff;border-color:var(--celadon)}
.seal{width:19px;height:19px;border-radius:5px;color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.module{margin:26px 0;scroll-margin-top:64px}
.mod-head{display:flex;gap:13px;align-items:flex-start;padding:14px 16px;border-radius:14px 14px 0 0;background:linear-gradient(180deg,var(--soft),transparent);border:1px solid var(--line);border-bottom:none}
.seal.big{width:42px;height:42px;border-radius:10px;font-size:22px;box-shadow:0 4px 12px -4px rgba(0,0,0,.3)}
.mod-head h2{margin:0;font-size:21px}
.mod-head .cnt{font-size:12px;color:var(--ink3);font-weight:400;margin-left:6px}
.mod-head .sub{font-size:12.5px;color:var(--celadon);margin:2px 0 0}
.mod-head .md{font-size:13px;color:var(--ink2);margin:5px 0 0}
.mbody{border:1px solid var(--line);border-top:none;border-radius:0 0 14px 14px;background:rgba(255,255,255,.35);padding:8px 14px 14px}
.submod{margin-top:14px}
.submod>.sh{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:700;color:var(--celadon);margin:6px 0 8px}
.submod>.sh::before{content:"";width:13px;height:13px;background:var(--gold);transform:rotate(45deg);display:inline-block;flex:none}
.submod>.sh .scnt{font-size:11px;color:var(--ink3);font-weight:400}
.logic{margin-top:6px;background:#eef3ea;border-radius:8px;padding:7px 11px;font-size:12.8px;color:#4f6a55;line-height:1.65}
.logic b{color:var(--celadon);font-style:normal;background:#fff;border-radius:4px;padding:0 6px;margin-right:6px;font-size:11px;font-family:system-ui}
.foot{margin:42px 0 28px;text-align:center;color:var(--ink3);font-size:12px}
.foot .gold{color:var(--gold)}
@media print{.tabs{display:none}.module,.feat,.item,.submod{break-inside:avoid}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

function buildFeatureList() {
  const tabBtns = TABS.map((t) => `<button class="tabchip" onclick="document.getElementById('m-${t.key}').scrollIntoView({behavior:'smooth',block:'start'})"><i class="seal" style="background:${t.accent}">${t.glyph}</i>${esc(t.tab)} <b>${t.modules.reduce((a, m) => a + m.features.length, 0)}</b></button>`).join("");
  const secs = TABS.map((t) => {
    const subs = t.modules.map((m) => {
      const cards = m.features.map((x) => `<div class="feat"><div class="fn">${esc(x.n)}</div><div class="fd">${esc(x.d)}</div><div class="logic"><b>运作逻辑</b>${esc(x.lg)}</div></div>`).join("");
      return `<div class="submod"><div class="sh">${esc(m.name)} <span class="scnt">${m.features.length}</span></div><div class="grid">${cards}</div></div>`;
    }).join("");
    return `<section class="module" id="m-${t.key}" style="--soft:${t.soft}">
      <div class="mod-head"><i class="seal big" style="background:${t.accent}">${t.glyph}</i><div>
        <h2>${esc(t.tab)} <span class="cnt">${t.modules.length} 模块 · ${t.modules.reduce((a, m) => a + m.features.length, 0)} 功能点</span></h2>
        <p class="sub">${esc(t.sub)}</p><p class="md">${esc(t.desc)}</p></div></div>
      <div class="mbody">${subs}</div></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI 图书馆 · 功能清单</title><style>${CSS}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
.feat{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:9px;padding:11px 13px}
.fn{font-weight:700;font-size:14.5px}
.fd{margin-top:4px;font-size:13px;color:var(--ink2);line-height:1.65}
</style></head><body>
<div class="hero"><div class="wrap">
  <p class="kicker">AI 图书馆 · 功能清单（产品视角）</p>
  <h1>这个 App 有哪些功能 · 各自怎么运作</h1>
  <p class="pos">三级结构：底部 Tab → 功能模块 → 功能点。每个功能点除了“做什么”，还讲清“背后怎么运作”（大白话，不是代码）。共 ${TABS.length} 个 Tab、${totalFeatures} 个功能点，已对照全代码核对、无遗漏。</p>
  <div class="stat"><div><b>${TABS.length}</b><span>Tab</span></div><div><b>${TABS.reduce((a, t) => a + t.modules.length, 0)}</b><span>功能模块</span></div><div><b>${totalFeatures}</b><span>功能点</span></div></div>
</div></div>
<div class="tabs"><div class="wrap">${tabBtns}</div></div>
<div class="wrap">${secs}<div class="foot">AI 图书馆 H5 · 功能清单 · ${DATE}<br/><span class="gold">东方典雅 · 古书新韵</span></div></div>
</body></html>`;
}

function buildAcceptance() {
  const tabBtns = `<button class="tabchip active" data-tab="all">全部</button>` +
    TABS.map((t) => `<button class="tabchip" data-tab="${t.key}"><i class="seal" style="background:${t.accent}">${t.glyph}</i>${esc(t.tab)}</button>`).join("");
  const secs = TABS.map((t) => {
    let mi = 0;
    const subs = t.modules.map((m) => {
      mi++;
      let fi = 0;
      const its = m.features.map((x) => {
        fi++;
        const id = `${t.key}-${mi}-${fi}`;
        const steps = (x.st || []).map((s) => `<li>${esc(s)}</li>`).join("");
        return `<div class="item" data-id="${id}">
          <div class="ih"><span class="fn">${esc(x.n)}</span><span class="vmark" data-for="${id}"></span></div>
          <div class="fd">${esc(x.d)}</div>
          <div class="logic"><b>运作逻辑</b>${esc(x.lg)}</div>
          <div class="steps"><div class="slab">验证步骤</div><ol>${steps}</ol></div>
          <div class="row"><span class="k">应看到</span><span class="v">${esc(x.e)}</span></div>
          <div class="verdict">
            <label class="vb done"><input type="radio" name="v-${id}" value="done"><span>✓ 完成</span></label>
            <label class="vb todo"><input type="radio" name="v-${id}" value="todo"><span>✗ 未完成</span></label>
            <input class="note" data-id="${id}" placeholder="备注（未完成时写：哪一步、哪里不对）"/>
          </div></div>`;
      }).join("");
      return `<div class="submod"><div class="sh">${esc(m.name)} <span class="scnt">${m.features.length}</span></div>${its}</div>`;
    }).join("");
    return `<section class="module" id="m-${t.key}" data-mod="${t.key}" style="--soft:${t.soft}">
      <div class="mod-head"><i class="seal big" style="background:${t.accent}">${t.glyph}</i><div>
        <h2>${esc(t.tab)} <span class="cnt">${t.modules.length} 模块 · ${t.modules.reduce((a, m) => a + m.features.length, 0)} 项</span></h2>
        <p class="sub">${esc(t.sub)}</p></div></div>
      <div class="mbody">${subs}</div></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI 图书馆 · 验收清单</title><style>${CSS}
.bar{height:9px;border-radius:5px;background:#e3dac7;overflow:hidden;display:flex}
.bar i{display:block;height:100%}.bar .d{background:#6f9b80}.bar .t{background:#cf6a5c}
.prog{flex:1;min-width:170px}.stat2{font-size:12px;color:var(--ink2);margin-top:4px}.stat2 b{color:var(--ink)}
.btn{border:1px solid var(--gold);background:#fff;color:#8a6d3b;border-radius:18px;padding:5px 13px;font:inherit;font-size:12.5px;cursor:pointer}
.btn:hover{background:#fbf3e3}
.note-box{background:#fdf6e3;border:1px solid #e7d9b0;border-radius:12px;padding:12px 16px;font-size:13px;color:#7a6326;margin:18px 0}
.item{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:10px;padding:11px 13px;margin:8px 0}
.item.s-done{border-left-color:#6f9b80;background:#f6faf4}
.item.s-todo{border-left-color:#cf6a5c;background:#fcf3f1}
.ih{display:flex;align-items:center;gap:8px}
.fn{font-weight:700;font-size:15px}
.vmark{margin-left:auto;font-size:14px;font-weight:700}
.fd{margin-top:4px;font-size:13px;color:var(--ink2)}
.steps{margin-top:7px}
.steps .slab{font-size:11px;font-family:system-ui;color:#fff;background:var(--gold);display:inline-block;border-radius:5px;padding:1px 8px}
.steps ol{margin:5px 0 0;padding-left:22px}
.steps li{font-size:13px;color:var(--ink);margin:2px 0;line-height:1.6}
.row{display:flex;gap:9px;margin-top:7px;font-size:13px}
.row .k{flex:none;width:46px;color:#fff;background:#6f9b80;border-radius:5px;font-size:11px;font-family:system-ui;text-align:center;height:20px;line-height:20px}
.row .v{color:var(--ink2);flex:1}
.verdict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px;border-top:1px dashed var(--line);padding-top:9px}
.vb{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-family:system-ui;cursor:pointer;border:1px solid var(--line);border-radius:16px;padding:4px 13px;user-select:none}
.vb input{display:none}
.vb.done.on{background:#6f9b80;color:#fff;border-color:#6f9b80}
.vb.todo.on{background:#cf6a5c;color:#fff;border-color:#cf6a5c}
.note{flex:1;min-width:180px;border:1px solid var(--line);border-radius:8px;padding:6px 11px;font:inherit;font-size:12.5px;background:#fff}
.note:focus{outline:none;border-color:var(--celadon)}
.hide{display:none !important}
</style></head><body>
<div class="hero"><div class="wrap">
  <p class="kicker">AI 图书馆 · 验收清单（产品视角）</p>
  <h1>逐条验收 · 看懂逻辑 · 照步骤验</h1>
  <p class="pos">三级结构：底部 Tab → 功能模块 → 功能点。每条含【运作逻辑】（背后怎么跑）+【验证步骤】（一步步怎么操作）+【应看到】。照步骤做、对照结果，选“完成/未完成”，不对就在备注写清是哪一步。共 ${totalFeatures} 项、进度自动存本浏览器。验完点“导出未完成”发我——前端还是后端、怎么改我来处理。</p>
  <div class="stat"><div><b>${totalFeatures}</b><span>待验功能点</span></div><div><b>${TABS.reduce((a, t) => a + t.modules.length, 0)}</b><span>功能模块</span></div><div><b>线上</b><span>goodcontent.cn</span></div></div>
</div></div>
<div class="tabs"><div class="wrap">
  <div class="prog"><div class="bar"><i class="d" id="bd"></i><i class="t" id="bt"></i></div>
    <div class="stat2"><b id="sd">0</b> 完成 · <b id="st">0</b> 未完成 · 共 <b>${totalFeatures}</b></div></div>
  ${tabBtns}
  <button class="btn" id="export">导出未完成</button>
  <button class="btn" id="reset">清空</button>
</div></div>
<div class="wrap">
  <div class="note-box">每条先看【运作逻辑】理解它该怎么跑，再照【验证步骤】一步步操作，最后对照【应看到】。不确定先空着；确认有问题选“未完成”并写清卡在哪一步。</div>
  ${secs}
  <div class="foot">AI 图书馆 H5 · 验收清单 · ${DATE}<br/>东方典雅 · 古书新韵</div>
</div>
<div id="modal" class="hide" style="position:fixed;inset:0;z-index:80;background:rgba(40,38,32,.5);display:flex;align-items:center;justify-content:center;padding:20px">
  <div style="background:#fffdf8;border-radius:14px;max-width:720px;width:100%;max-height:80vh;overflow:auto;padding:20px;border:1px solid var(--line)">
    <h3 style="margin:0 0 8px">未完成清单（复制发我）</h3>
    <textarea id="etext" style="width:100%;height:300px;border:1px solid var(--line);border-radius:8px;padding:10px;font-family:Consolas,monospace;font-size:12px"></textarea>
    <div style="margin-top:10px;text-align:right"><button class="btn" id="copy">复制</button> <button class="btn" id="close">关闭</button></div>
  </div>
</div>
<script>
const KEY="ail-accept-pm-v3";const state=JSON.parse(localStorage.getItem(KEY)||"{}");
const items=[...document.querySelectorAll(".item")];const TOTAL=${totalFeatures};
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
function paint(el){const id=el.dataset.id,s=state[id]||{};el.classList.remove("s-done","s-todo");
  el.querySelectorAll(".vb").forEach(b=>b.classList.remove("on"));const m=el.querySelector(".vmark");m.textContent="";
  if(s.v){el.classList.add("s-"+s.v);const l=el.querySelector(".vb."+s.v);if(l)l.classList.add("on");
    m.textContent=s.v==="done"?"✓":"✗";m.style.color=s.v==="done"?"#4a7359":"#b04a3c";
    const r=el.querySelector('input[value="'+s.v+'"]');if(r)r.checked=true;}
  const n=el.querySelector(".note");if(n&&s.note!==undefined)n.value=s.note;}
function stats(){let d=0,t=0;for(const k in state){if(state[k].v==="done")d++;else if(state[k].v==="todo")t++;}
  sd.textContent=d;st.textContent=t;bd.style.width=(d/TOTAL*100)+"%";bt.style.width=(t/TOTAL*100)+"%";}
items.forEach(el=>{const id=el.dataset.id;
  el.querySelectorAll('input[type=radio]').forEach(r=>r.addEventListener("change",()=>{state[id]=Object.assign({},state[id],{v:r.value});save();paint(el);stats();}));
  const n=el.querySelector(".note");n.addEventListener("input",()=>{state[id]=Object.assign({},state[id],{note:n.value});save();});
  paint(el);});
stats();
let tab="all";document.querySelectorAll(".tabchip[data-tab]").forEach(c=>c.addEventListener("click",()=>{
  document.querySelectorAll(".tabchip[data-tab]").forEach(x=>x.classList.remove("active"));c.classList.add("active");tab=c.dataset.tab;
  document.querySelectorAll(".module").forEach(s=>s.classList.toggle("hide",tab!=="all"&&s.dataset.mod!==tab));}));
function $(i){return document.getElementById(i)}
$("export").onclick=()=>{let out="AI 图书馆 验收·未完成清单 "+new Date().toLocaleString()+"\\n\\n";let arr=[];
  items.forEach(el=>{const s=state[el.dataset.id]||{};if(s.v==="todo"){const mod=el.closest(".module").querySelector("h2").textContent.trim().split(" ")[0];
    const sm=el.closest(".submod").querySelector(".sh").textContent.trim().split(" ")[0];
    arr.push("[未完成] "+mod+" / "+sm+" / "+el.querySelector(".fn").textContent+(s.note?" — "+s.note:""));}});
  out+=arr.length?arr.join("\\n"):"（暂无未完成项 🎉）";etext.value=out;modal.classList.remove("hide");};
$("close").onclick=()=>modal.classList.add("hide");
$("copy").onclick=()=>{etext.select();try{navigator.clipboard.writeText(etext.value)}catch(e){document.execCommand("copy")}};
$("reset").onclick=()=>{if(confirm("确定清空全部勾选？")){for(const k in state)delete state[k];save();items.forEach(paint);stats();}};
</script></body></html>`;
}

const outDir = "docs/交付物";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "01_功能清单.html"), buildFeatureList(), "utf8");
fs.writeFileSync(path.join(outDir, "02_验收清单.html"), buildAcceptance(), "utf8");
console.log("已生成 | Tab", TABS.length, "| 模块", TABS.reduce((a, t) => a + t.modules.length, 0), "| 功能点", totalFeatures);
