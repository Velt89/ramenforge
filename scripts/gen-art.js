/**
 * gen-art.js — generates all RamenForge SVG card art into frontend/public/art/.
 * One shared card frame (cream card, corner dots, RAMENFORGE header, bottom
 * label) with a simple shape illustration per item. Rarity is signalled by
 * the ring color: uncommon = warm tan, rare = violet, epic = gold + sparkles.
 * Run: node scripts/gen-art.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "frontend", "public", "art");
fs.mkdirSync(OUT, { recursive: true });

function frame(label, sub, body, ring = "#EAD9B8") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" rx="28" fill="#FFF3DC"/>
  <circle cx="42" cy="46" r="5" fill="#F0B64A"/><circle cx="358" cy="46" r="5" fill="#F0B64A"/>
  <circle cx="42" cy="354" r="5" fill="#F0B64A"/><circle cx="358" cy="354" r="5" fill="#F0B64A"/>
  <text x="200" y="52" text-anchor="middle" font-family="Verdana, sans-serif" font-size="19" font-weight="bold" letter-spacing="6" fill="#B4762A">RAMENFORGE</text>
  <ellipse cx="200" cy="212" rx="138" ry="108" fill="#FFFFFF" stroke="${ring}" stroke-width="4"/>
  <ellipse cx="200" cy="208" rx="106" ry="82" fill="#FDF6E7"/>
${body}
  <text x="200" y="356" text-anchor="middle" font-family="Verdana, sans-serif" font-size="27" font-weight="bold" fill="#6B3F14">${label}</text>
  <text x="200" y="380" text-anchor="middle" font-family="Verdana, sans-serif" font-size="14" letter-spacing="3" fill="#B4762A">${sub}</text>
</svg>
`;
}

const sparkles = `
  <g fill="#F5B81E">
    <path d="M108 108 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 z"/>
    <path d="M296 92 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 z"/>
    <path d="M312 268 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 z"/>
  </g>`;

const bowl = (broth = "#F7C65C", bowlFill = "#B03A3A", baseFill = "#8E2B2B") => `
  <path d="M100 196 L300 196 L282 262 Q200 284 118 262 Z" fill="${bowlFill}"/>
  <rect x="150" y="276" width="100" height="12" rx="6" fill="${baseFill}"/>
  <ellipse cx="200" cy="196" rx="100" ry="20" fill="${broth}"/>`;

const noodleSwirls = `
  <g fill="none" stroke="#EFA93C" stroke-width="6" stroke-linecap="round">
    <path d="M140 194 q14 -10 28 0 q14 10 28 0"/>
    <path d="M196 202 q14 -10 28 0 q14 10 28 0"/>
    <path d="M158 184 q12 -8 24 0"/>
  </g>`;

const chopsticks = `
  <g stroke="#8A5A33" stroke-width="7" stroke-linecap="round">
    <line x1="262" y1="102" x2="226" y2="178"/>
    <line x1="284" y1="110" x2="246" y2="182"/>
  </g>`;

const eggHalf = (cx, cy) => `
  <circle cx="${cx}" cy="${cy}" r="16" fill="#FFFFFF"/>
  <circle cx="${cx}" cy="${cy}" r="8" fill="#F5B81E"/>`;

const art = {
  "handmade-noodles": frame("Handmade Noodles", "UNCOMMON · INGREDIENT", `
  ${bowl()}
  ${noodleSwirls}
  ${noodleSwirls.replaceAll("194", "176").replaceAll("202", "186").replaceAll("184", "168")}
  ${chopsticks}`),

  "tonkotsu-broth": frame("Tonkotsu Broth", "UNCOMMON · INGREDIENT", `
  <path d="M118 168 L282 168 L268 258 Q200 276 132 258 Z" fill="#5B7A99"/>
  <rect x="156" y="270" width="88" height="11" rx="5" fill="#41597A"/>
  <ellipse cx="200" cy="168" rx="82" ry="17" fill="#F3E3C2"/>
  <g fill="#FFFFFF" opacity="0.85">
    <circle cx="168" cy="164" r="7"/><circle cx="204" cy="158" r="9"/><circle cx="238" cy="165" r="6"/>
  </g>
  <g stroke="#D8C49A" stroke-width="5" stroke-linecap="round" fill="none">
    <path d="M160 128 q6 -12 0 -22"/><path d="M200 132 q6 -12 0 -22"/><path d="M240 128 q6 -12 0 -22"/>
  </g>`),

  "scallion": frame("Scallion", "UNCOMMON · INGREDIENT", `
  <g stroke-linecap="round" fill="none">
    <path d="M150 268 Q146 190 128 128" stroke="#3E9B4F" stroke-width="13"/>
    <path d="M182 272 Q182 186 176 108" stroke="#57B368" stroke-width="13"/>
    <path d="M214 272 Q220 190 240 122" stroke="#3E9B4F" stroke-width="13"/>
    <path d="M246 268 Q258 200 282 150" stroke="#57B368" stroke-width="11"/>
  </g>
  <ellipse cx="200" cy="276" rx="72" ry="14" fill="#2F7A3E"/>
  <g fill="#7ED491">
    <circle cx="164" cy="252" r="7"/><circle cx="196" cy="262" r="7"/><circle cx="228" cy="250" r="7"/><circle cx="206" cy="238" r="6"/>
  </g>`),

  "nori": frame("Nori", "UNCOMMON · INGREDIENT", `
  <g>
    <rect x="128" y="118" width="86" height="128" rx="8" fill="#22392B" transform="rotate(-7 171 182)"/>
    <rect x="188" y="112" width="86" height="128" rx="8" fill="#2E4A38" transform="rotate(6 231 176)"/>
    <rect x="158" y="126" width="86" height="128" rx="8" fill="#1C2F24" transform="rotate(-1 201 190)"/>
  </g>
  <g fill="#3E5F4B" opacity="0.7">
    <circle cx="182" cy="160" r="5"/><circle cx="222" cy="196" r="5"/><circle cx="196" cy="222" r="4"/>
  </g>`),

  "chashu-pork": frame("Chashu Pork", "RARE · INGREDIENT", `
  <ellipse cx="200" cy="238" rx="96" ry="26" fill="#FFFFFF" stroke="#D9C8A8" stroke-width="3"/>
  <g>
    <circle cx="158" cy="196" r="42" fill="#C97B5A"/>
    <circle cx="158" cy="196" r="30" fill="#E0A184"/>
    <path d="M136 178 q22 -14 44 0 q-10 10 -22 10 q-12 0 -22 -10" fill="#F2C4A7"/>
    <circle cx="238" cy="188" r="46" fill="#C97B5A"/>
    <circle cx="238" cy="188" r="33" fill="#E0A184"/>
    <path d="M212 168 q26 -16 52 0 q-12 12 -26 12 q-14 0 -26 -12" fill="#F2C4A7"/>
  </g>`, "#B9A7E6"),

  "ajitama-egg": frame("Ajitama Egg", "RARE · INGREDIENT", `
  <ellipse cx="200" cy="246" rx="92" ry="24" fill="#FFFFFF" stroke="#D9C8A8" stroke-width="3"/>
  <g>
    <ellipse cx="162" cy="198" rx="44" ry="52" fill="#FDFBF6"/>
    <ellipse cx="162" cy="206" r="24" fill="#E8862E"/>
    <ellipse cx="162" cy="206" r="13" fill="#F5B81E"/>
    <ellipse cx="240" cy="190" rx="40" ry="48" fill="#F3E7CE"/>
    <ellipse cx="240" cy="198" r="21" fill="#E8862E"/>
    <ellipse cx="240" cy="198" r="11" fill="#F5B81E"/>
  </g>
  <g fill="#8A5A33"><circle cx="140" cy="160" r="3"/><circle cx="262" cy="152" r="3"/><circle cx="228" cy="238" r="3"/></g>`, "#B9A7E6"),

  "wagyu-slice": frame("Wagyu Slice", "EPIC · INGREDIENT", `
  <ellipse cx="200" cy="244" rx="98" ry="25" fill="#2B2B2B"/>
  <path d="M118 208 Q200 168 282 208 Q268 252 200 256 Q132 252 118 208 Z" fill="#A52A3A"/>
  <g stroke="#F6D9D2" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.9">
    <path d="M140 206 q28 -14 52 -4"/>
    <path d="M196 198 q30 -10 58 4"/>
    <path d="M150 232 q40 -12 92 -2"/>
    <path d="M206 224 q22 -8 44 2"/>
  </g>
  ${sparkles}`, "#F5B81E"),

  "ramen": frame("Ramen", "COOKED · STAGE 1", `
  ${bowl()}
  ${noodleSwirls}
  ${eggHalf(152, 186)}
  <rect x="238" y="166" width="30" height="34" rx="4" fill="#2E4A2E"/>
  ${chopsticks}`),

  "ramen-deluxe": frame("Deluxe Ramen", "COOKED · STAGE 2", `
  ${bowl("#F9D976", "#7A4FA3", "#5E3A82")}
  ${noodleSwirls}
  ${eggHalf(146, 184)}
  ${eggHalf(196, 178)}
  <circle cx="248" cy="184" r="17" fill="#C97B5A"/>
  <circle cx="248" cy="184" r="10" fill="#E0A184"/>
  <rect x="118" y="168" width="26" height="30" rx="4" fill="#2E4A2E"/>
  ${chopsticks}`, "#B9A7E6"),

  "ramen-golden": frame("Golden Ramen", "COOKED · STAGE 3 · /100", `
  ${bowl("#FFE066", "#D9A41C", "#B98F22")}
  ${noodleSwirls}
  ${eggHalf(150, 184)}
  <circle cx="240" cy="182" r="18" fill="#A52A3A"/>
  <path d="M228 176 q12 -7 24 0" stroke="#F6D9D2" stroke-width="4" fill="none" stroke-linecap="round"/>
  <rect x="238" y="160" width="30" height="34" rx="4" fill="#2E4A2E"/>
  ${chopsticks}
  ${sparkles}`, "#F5B81E"),

  "founder-pass": frame("Founder Pass", "FOUNDER CHEF PASS", `
  <g transform="rotate(-6 200 200)">
    <rect x="104" y="140" width="192" height="118" rx="14" fill="#2B2B2B"/>
    <rect x="104" y="140" width="192" height="34" rx="14" fill="#D9A41C"/>
    <text x="200" y="164" text-anchor="middle" font-family="Verdana, sans-serif" font-size="15" font-weight="bold" letter-spacing="2" fill="#2B2B2B">FOUNDER CHEF</text>
    <circle cx="140" cy="212" r="17" fill="#F7C65C"/>
    <circle cx="140" cy="212" r="9" fill="#EFA93C"/>
    <rect x="168" y="198" width="104" height="10" rx="5" fill="#FDF6E7"/>
    <rect x="168" y="218" width="76" height="10" rx="5" fill="#B9A7E6"/>
    <circle cx="278" cy="240" r="5" fill="#FFF3DC"/><circle cx="256" cy="240" r="5" fill="#FFF3DC"/>
  </g>`, "#F5B81E"),

  "founder-badge": frame("Founder Badge", "SOULBOUND · NUMBERED", `
  <circle cx="200" cy="196" r="62" fill="#D9A41C"/>
  <circle cx="200" cy="196" r="48" fill="#F5B81E"/>
  <circle cx="200" cy="196" r="36" fill="#FFF3DC"/>
  <path d="M178 208 L168 262 L200 240 L232 262 L222 208" fill="#B03A3A"/>
  <text x="200" y="206" text-anchor="middle" font-family="Verdana, sans-serif" font-size="26" font-weight="bold" fill="#B4762A">F</text>
  ${sparkles}`, "#F5B81E"),

  "trophy": frame("Golden Chef", "TROPHY · SOULBOUND", `
  <path d="M156 118 h88 v34 q0 40 -44 40 q-44 0 -44 -40 z" fill="#F5B81E"/>
  <path d="M156 128 q-34 2 -30 28 q3 22 36 20" fill="none" stroke="#D9A41C" stroke-width="9"/>
  <path d="M244 128 q34 2 30 28 q-3 22 -36 20" fill="none" stroke="#D9A41C" stroke-width="9"/>
  <rect x="190" y="192" width="20" height="22" fill="#D9A41C"/>
  <rect x="162" y="214" width="76" height="14" rx="5" fill="#B98F22"/>
  <rect x="148" y="232" width="104" height="12" rx="6" fill="#8A6A14"/>
  <g fill="none" stroke="#FFF3DC" stroke-width="5" stroke-linecap="round">
    <path d="M178 148 q11 -8 22 0 q11 8 22 0"/>
  </g>
  ${sparkles}`, "#F5B81E"),

  "badge-bronze": frame("Bronze Feast", "BADGE · BEST STREAK 3", `
  <circle cx="200" cy="196" r="60" fill="#C9803A"/><circle cx="200" cy="196" r="46" fill="#E09A58"/>
  <path d="M182 150 h36 l-6 34 h-24 z" fill="#FFF3DC"/>
  <path d="M176 160 q24 12 48 0" stroke="#EFA93C" stroke-width="5" fill="none"/>`),
  "badge-silver": frame("Silver Feast", "BADGE · BEST STREAK 7", `
  <circle cx="200" cy="196" r="60" fill="#9AA3AD"/><circle cx="200" cy="196" r="46" fill="#C7CED6"/>
  <path d="M182 150 h36 l-6 34 h-24 z" fill="#FFF3DC"/>
  <path d="M176 160 q24 12 48 0" stroke="#EFA93C" stroke-width="5" fill="none"/>`),
  "badge-gold": frame("Gold Feast", "BADGE · BEST STREAK 14", `
  <circle cx="200" cy="196" r="60" fill="#D9A41C"/><circle cx="200" cy="196" r="46" fill="#F5B81E"/>
  <path d="M182 150 h36 l-6 34 h-24 z" fill="#FFF3DC"/>
  <path d="M176 160 q24 12 48 0" stroke="#EFA93C" stroke-width="5" fill="none"/>
  ${sparkles}`, "#F5B81E"),
};

for (const [slug, svg] of Object.entries(art)) {
  fs.writeFileSync(path.join(OUT, `${slug}.svg`), svg);
  console.log("wrote", slug + ".svg");
}
// favicon: golden bowl mark
fs.writeFileSync(
  path.join(__dirname, "..", "frontend", "public", "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#FFF3DC"/>
  <path d="M18 44 L82 44 L74 68 Q50 78 26 68 Z" fill="#D9A41C"/>
  <ellipse cx="50" cy="44" rx="32" ry="7" fill="#FFE066"/>
  <g fill="none" stroke="#EFA93C" stroke-width="4" stroke-linecap="round">
    <path d="M32 42 q9 -6 18 0 q9 6 18 0"/>
  </g>
</svg>
`
);
console.log("wrote favicon.svg");
