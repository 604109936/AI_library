# 批量生成候选图（馆徽×3 / 开屏×3 / 男生头像×3 / 详情简介UI×3）
$ErrorActionPreference = "Continue"
$prompts = @(
  "A refined emblem logo for a classical Chinese library app: a carved square seal frame enclosing a stylized open book with mountain and cloud motif, celadon green and ink wash on rice paper, intricate elegant linework, centered icon, no text, no letters",
  "A refined emblem logo for a classical Chinese library app: stacked thread-bound ancient books with a writing brush and an unfurling scroll, circular seal composition, celadon green and brass tones, delicate ornament, centered app icon, no text, no letters",
  "A refined emblem logo for a classical Chinese library app: an abstract classical library pavilion gate with bamboo, inside a rounded square seal, celadon green and ink, minimal and elegant, centered icon, no text, no letters",
  "New Chinese style vertical 9:16 splash screen for a reading app: a grand classical library pavilion among misty mountains and bamboo, celadon and ink wash, warm rice-paper sky, tranquil, generous negative space, high-end editorial illustration, no text, no letters",
  "New Chinese style vertical 9:16 splash screen for a reading app: a scholar desk by a round moon window with stacked ancient books, a teacup and a softly glowing desk lamp, gentle morning light, celadon and brass accents, ink wash, serene mood, no text, no letters",
  "New Chinese style vertical 9:16 splash screen for a reading app: an open thread-bound book unfolding into mountains clouds and flying cranes, celadon green ink illustration on moon-white background, poetic and minimal, no text, no letters",
  "New Chinese style male reading companion mascot avatar: a friendly young scholar with a gentle smile, simple linen robe, ink wash and celadon tones, head and shoulders, square composition, warm rice-paper background, no text, no letters",
  "New Chinese style male reading companion mascot avatar: a cute chibi young scholar holding a book, big kind eyes, celadon robe, soft ink outline, square avatar, warm background, no text, no letters",
  "New Chinese style male reading companion mascot avatar: an elegant young scholar with a hair bun holding a writing brush, calm warm expression, ink wash celadon and brass, square avatar, warm background, no text, no letters",
  "Mobile app UI design mockup of a book introduction section card, new Chinese style, celadon green accents on rice-paper white, a vertical celadon accent bar beside an elegant serif section title, soft rounded card, refined minimal typography blocks, editorial layout, calm",
  "Mobile app UI design mockup of a book introduction section card, new Chinese style, framed by delicate ink ornament and a subtle bamboo corner motif, celadon and brass on warm white, elegant serif title, layered soft cards, refined",
  "Mobile app UI design mockup of a book introduction section card, new Chinese style, magazine-like layout with a large pull-quote, celadon hairline dividers, generous whitespace, refined serif typography, faint ink-wash texture, elegant"
)
$i = 0
foreach ($p in $prompts) {
  $i++
  Write-Output "=== GEN $i / $($prompts.Count) ==="
  '' | codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C "D:\ClaudeCode\AI_library" "/imagegen $p"
}
Write-Output "ALL DONE"
