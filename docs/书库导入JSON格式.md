# 书库导入 JSON 格式（3.2 导书用）

> 用途：你按此格式生成**真实书籍数据**（JSON），保存为 `data/books.json`，我用脚本经 service_role 一键导入 Supabase 的 `categories / books / chapters` 三张表。
> 字段命名与数据库列一致；标 ⚙️ 的字段**可不填，脚本自动推导**。

## 一、整体结构

```json
{
  "books": [
    { /* 书 1，见下 */ },
    { /* 书 2 */ }
  ]
}
```

> 分类（6 个）由脚本**自动建好**，你的 JSON **只需 `books` 数组**。
> 如需新增/修改分类，见文末「分类清单」，告诉我即可。

## 二、书（books[] 每一项）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `id` | ✅ | string | 英文短 slug，唯一，如 `"mindset"`。章节 id 会基于它生成 |
| `title` | ✅ | string | 书名 |
| `author` | ✅ | string | 作者 |
| `category_id` | ✅ | string | 所属分类，**必须是文末 6 个之一**（如 `"growth"`） |
| `summary` | ✅ | string | 简介（**给读者看**，详情页展示，100~200 字佳） |
| `intro` | ✅ | string | 一句话推荐语（乱翻/详情用，≤20 字） |
| `tags` | 建议 | string[] | 题材标签，**不含分类名**（前端会自动把分类名置顶），如 `["学习方法","自律"]` |
| `words` | 建议 | int | 全书字数（**数字类型，非字符串**；用于"约 X 字"展示与时长估算） |
| `cover_url` | 建议 | string | 封面 OSS 公开 URL；不填则前端暂用本地兜底封面 |
| `video_url` | 有视频则填 | string | 视频 OSS 公开 URL；**填了即视为该书有视频** |
| `audio_url` | 有音频则填 | string | 音频 OSS 公开 URL；**填了即视为该书有音频** |
| `ai_digest` | 建议 | string | **给「智学」Agent**的 200 字概要：为什么推荐 / 解决什么问题 / 中心思想（**不展示给用户**） |
| `featured` | ⚙️ | bool | 是否精选/热门好书，默认 `false` |
| `shelved_at` | ⚙️ | — | **不用填**：导入时按数组顺序逐条插入真实时间戳，**排在最后的=最新**。它决定：分类默认倒序 / 首页 Banner 取每类最新 / **热门好书排序** |
| `chapters` | ✅ | array | 章节数组，见下 |
| ⚙️ has_video/has_audio/has_text | — | — | 不用填，**自动推导**：有 `video_url`→有视频，有 `audio_url`→有音频，章节有 `content`→有文字稿 |
| ⚙️ duration_min | — | — | 不用填，按 `words` 自动估算 |
| ⚙️ cover_seed | — | — | 不用填，自动按顺序分配 |
| ⚙️ rating/readers/fav_count/review_count/read_count | — | — | 不用填，默认 0，后端触发器/RPC 维护 |

> ① 每本书都传「文字稿 + 音频 + 视频」三样，就**三个 URL 都给、章节都带 content**，has_video/has_audio/has_text 自动全为 true，**无需 `modes` 字段**。
> ② **`created_at`（出版日期）已弃用**：因真实出版时间拿不到，排序/推荐统一改用 `shelved_at`（入库时间）。你两个时间字段**都不用填**。

## 三、章节（books[].chapters[] 每一项）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `no` | ✅ | int | 章序号，从 1 连续递增 |
| `title` | ✅ | string | 章标题 |
| `content` | 有文字稿则填 | string | **本章完整正文**（阅读器正文 + 智学 Agent「读取章内容」工具都用它）；章节有正文即视为该书有文字稿 |
| `ai_summary` | 建议 | string | **给「智学」Agent**的 100 字章概要：本章中心思想 / 解决什么问题（**不展示**） |
| ~~`audio_start`~~ | — | — | **不需要**：音视频是独立"解读"版、与文字章节不同源，无章节↔音频映射 |
| ⚙️ id / book_id | — | — | 不用填，自动生成（`id = {书id}-c{no}`） |

## 四、完整示例（一本书；真实数据须是合法 JSON）

```json
{
  "books": [
    {
      "id": "mindset",
      "title": "终身成长",
      "author": "卡罗尔·德韦克",
      "category_id": "growth",
      "summary": "斯坦福大学心理学教授卡罗尔·德韦克提出，决定人生走向的并非天赋，而是思维模式……",
      "intro": "重新定义成功的思维模式",
      "tags": ["学习方法", "自律"],
      "words": 167000,
      "cover_url": "https://你的bucket.oss-cn-xxx.aliyuncs.com/covers/mindset.webp",
      "video_url": "https://你的bucket.oss-cn-xxx.aliyuncs.com/videos/mindset.mp4",
      "audio_url": "https://你的bucket.oss-cn-xxx.aliyuncs.com/audios/mindset.mp3",
      "ai_digest": "本书提出固定型/成长型两种思维模式……（≤200字，供 Agent 推荐与答疑，不展示）",
      "featured": true,
      "chapters": [
        {
          "no": 1,
          "title": "思维模式的力量",
          "content": "（本章完整正文，可数千字……）",
          "ai_summary": "本章引入思维模式概念……（≤100字，供 Agent，不展示）",
          "audio_start": 0
        },
        {
          "no": 2,
          "title": "思维模式解析",
          "content": "（本章完整正文……）",
          "ai_summary": "本章区分两种思维模式的表现……",
          "audio_start": 0
        }
      ]
    }
  ]
}
```

## 五、分类清单（category_id 取值，脚本自动建好这 6 个）

| category_id | 分类名 | lucide 图标 | 顺序 |
|---|---|---|---|
| `psy` | 心学 | Brain | 1 |
| `growth` | 成长 | Sprout | 2 |
| `tech` | 科技 | Cpu | 3 |
| `biz` | 商业 | TrendingUp | 4 |
| `lit` | 文学 | Feather | 5 |
| `his` | 历史 | Landmark | 6 |

## 六、注意事项

1. `id` 用英文短 slug、全库唯一；同一本书的章节 id 自动为 `{id}-c1`、`{id}-c2`……
2. `category_id` 必须是上表 6 个之一，否则该书导入失败（外键约束）。
3. **形态自动推导，无需 `modes` 字段**：给了 `video_url`→有视频、给了 `audio_url`→有音频、章节有 `content`→有文字稿。你三样都传，则三者都为真。
4. **时间字段都不用填**：`created_at` 已弃用；`shelved_at` 由导入顺序自动生成（最后=最新）。
5. `ai_digest`（书）与 `ai_summary`（章）是**智学 Agent 的关键输入**，强烈建议填，否则 Agent 推荐/答疑质量会下降。
6. `words` 必须是数字。
7. 真实 `data/books.json` 必须是**合法 JSON**：不能有 `#`/`//` 注释、字符串里的换行用 `\n`。
8. 文件保存为 UTF-8、放在 `data/books.json`（或告诉我别的路径）。
9. 导入两种模式：**非覆盖（默认）**=库中已有的 book_id 跳过不动；**覆盖**（`--overwrite`）=已有的更新（章节先删后插）。可放心多次跑、分批补。
