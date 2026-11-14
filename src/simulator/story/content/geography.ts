import type { Border, Location, Sector } from "../StoryTypes";

/**
 * The archipelago as a map (docs/campaign/world.md, drawn to docs/campaign/map.svg).
 *
 * Not rings round a centre but neighbouring districts, the way a real
 * archipelago lies: the reef belt of the Dead Tide along the south-west, the
 * mangrove skerries of the Green Squall across the north, the dry atoll of
 * the Sand Teeth to the south-east, and the Open Wedge — a tongue of deep
 * ocean — driving in from the west between the reefs and the skerries
 * until it ends at the one fairway into the Black Caldera.
 *
 * Every border is written once and shared by the two sides it divides, so
 * moving a strait moves it for both. Points are metres east and north of the
 * world's origin (the free-sail start). The quarantine line is a run of
 * straight legs, as a declared exclusion zone is.
 *
 * Junctions: A (-2450, 250) the caldera's fairway at the tip of the Wedge;
 * B (-1600, -1350) the caldera's south-west corner; C (350, 1250) its
 * north-east corner; and where the inner borders meet the quarantine line.
 */
export const BORDERS: readonly Border[] = [
  // The quarantine line, clockwise from the south-west.
  { id: "q-west", points: [[-10400, -1200], [-10650, 350], [-10200, 1900]] },
  { id: "q-north", points: [[-10200, 1900], [-9300, 4700], [-6400, 6000], [-2300, 6200], [1600, 5650]] },
  { id: "q-east", points: [[1600, 5650], [4300, 3700], [4900, 300], [4300, -3900], [2300, -6300], [-2100, -6900]] },
  { id: "q-south", points: [[-2100, -6900], [-6600, -6350], [-9700, -3900], [-10400, -1200]] },
  // The Wedge's shores: its north shore against the skerries, its south shore against the reefs.
  { id: "wedge-north", points: [[-10200, 1900], [-8700, 2150], [-7300, 1900], [-6200, 1450], [-5000, 1250], [-3900, 850], [-3100, 700], [-2450, 250]] },
  { id: "wedge-south", points: [[-10400, -1200], [-9000, -1550], [-7800, -1250], [-6800, -950], [-5600, -1150], [-4500, -700], [-3400, -350], [-2450, 250]] },
  // The caldera's rim of basalt islets, from the fairway round by the north.
  { id: "caldera-north", points: [[-2450, 250], [-2200, 1000], [-1500, 1450], [-700, 1600], [0, 1500], [350, 1250]] },
  { id: "caldera-east", points: [[350, 1250], [700, 700], [650, -100], [300, -800], [-400, -1350], [-1600, -1350]] },
  { id: "caldera-southwest", points: [[-1600, -1350], [-2100, -900], [-2350, -350], [-2450, 250]] },
  // The channels between the reef belt and the atoll, and between the skerries and the atoll.
  { id: "tide-teeth", points: [[-1600, -1350], [-1250, -2300], [-1700, -3300], [-1300, -4300], [-1900, -5300], [-1700, -6100], [-2100, -6900]] },
  { id: "squall-teeth", points: [[350, 1250], [1100, 1900], [1700, 2600], [1300, 3500], [1900, 4500], [1600, 5650]] },
];

export const QUARANTINE: readonly { border: string; reverse?: boolean }[] = [
  { border: "q-west" },
  { border: "q-north" },
  { border: "q-east" },
  { border: "q-south" },
];

export const SECTORS: readonly Sector[] = [
  {
    id: "dead-tide",
    label: [-6900, -3750],
    name: { ru: "Мёртвый прилив", en: "Dead Tide" },
    subtitle: { ru: "Рифовый пояс", en: "The reef belt" },
    color: "#7f9aa3",
    ring: [{ border: "q-south" }, { border: "wedge-south" }, { border: "caldera-southwest", reverse: true }, { border: "tide-teeth" }],
    // A cold set off the ocean: the fog banks of the reef belt.
    atmosphere: { haze: 0.45, weather: ["overcast", "cloudy", "rain"] },
    holder: "raiders",
    status: "playable",
  },
  {
    id: "open-wedge",
    label: [-8300, 700],
    name: { ru: "Открытый клин", en: "The Open Wedge" },
    subtitle: { ru: "Нейтральные глубины", en: "The neutral deep" },
    color: "#4f7fb8",
    ring: [{ border: "q-west" }, { border: "wedge-north" }, { border: "wedge-south", reverse: true }],
    atmosphere: { weather: ["storm", "rain", "overcast"] },
    holder: "aquilon",
    status: "planned",
  },
  {
    id: "green-squall",
    label: [-5200, 4500],
    name: { ru: "Зелёный шквал", en: "Green Squall" },
    subtitle: { ru: "Тропические шхеры", en: "The mangrove skerries" },
    color: "#3d9a5b",
    ring: [{ border: "q-north" }, { border: "squall-teeth", reverse: true }, { border: "caldera-north", reverse: true }, { border: "wedge-north", reverse: true }],
    atmosphere: { weather: ["rain", "downpour", "cloudy"] },
    holder: "vanguard",
    status: "planned",
  },
  {
    id: "sand-teeth",
    label: [2700, -1900],
    name: { ru: "Песчаные зубья", en: "Sand Teeth" },
    subtitle: { ru: "Выжженный атолл", en: "The scorched atoll" },
    color: "#d0a34c",
    ring: [{ border: "q-east" }, { border: "tide-teeth", reverse: true }, { border: "caldera-east", reverse: true }, { border: "squall-teeth" }],
    atmosphere: { weather: ["clear", "clear", "cloudy"] },
    holder: "vanguard",
    status: "planned",
  },
  {
    id: "black-caldera",
    label: [-900, 850],
    name: { ru: "Чёрная кальдера", en: "Black Caldera" },
    subtitle: { ru: "Вулканический узел", en: "The volcanic heart" },
    color: "#8c4b4b",
    ring: [{ border: "caldera-north" }, { border: "caldera-east" }, { border: "caldera-southwest" }],
    holder: "vanguard",
    status: "planned",
  },
];

/**
 * The story's places. A chart point is where the place roughly is; `snap`
 * fits it to what the procedural sea has there (the nearest island, pier or
 * open water). The ones not yet in play mark where the planned chapters lie.
 */
export const LOCATIONS: readonly Location[] = [
  // The prologue: in from the south-east at full speed, for the outer island of the reef belt.
  { id: "delivery", name: { ru: "Точка передачи груза", en: "The hand-over point" }, sector: "dead-tide", at: [-7121, -5300], snap: "water", radius: 90 },
  { id: "ambush-cay", name: { ru: "Низкий ки", en: "The low cay" }, sector: "dead-tide", at: [-6215, -5664], snap: "island", radius: 40 },
  { id: "reef-gap", name: { ru: "Проход в рифах у Косой отмели", en: "The gap in the reef off the Slant Shoal" }, sector: "dead-tide", at: [-7100, -5330], snap: "point", radius: 70 },
  { id: "crash", name: { ru: "Риф у Косой отмели", en: "The reef off the Slant Shoal" }, sector: "dead-tide", at: [-7111, -5296], snap: "point", radius: 30 },
  // M01, "You Should Be Dead": the outer island, Створ-9 on its north-east shore, Mark's cove across the lagoon.
  { id: "kosaya", name: { ru: "Косая отмель", en: "The Slant Shoal" }, sector: "dead-tide", at: [-7120, -5163], snap: "island", radius: 40, charted: true },
  { id: "stvor9", name: { ru: "Застава «Створ-9»", en: "Outpost Stvor-9" }, sector: "dead-tide", at: [-7067, -4955], snap: "point", radius: 60, charted: true },
  { id: "m01-pass", name: { ru: "Два белых камня", en: "The two white rocks" }, sector: "dead-tide", at: [-6643, -4770], snap: "point", radius: 26 },
  { id: "mark-cove", name: { ru: "Бухта Марка", en: "Mark's cove" }, sector: "dead-tide", at: [-6262, -4612], snap: "point", radius: 45, charted: true },
  // The four people of the arcs M01 opens (their first meetings are planned).
  { id: "kenji-lab", name: { ru: "Лагуна Кендзи", en: "Kenji's lagoon" }, sector: "dead-tide", at: [-6493, -3964], snap: "island", radius: 60 },
  { id: "sara-refuge", name: { ru: "Береговое убежище Сары", en: "Sara's shore refuge" }, sector: "dead-tide", at: [-5546, -3720], snap: "island", radius: 70 },
  { id: "viktor-gate", name: { ru: "Технический вход Седова", en: "Sedov's service entrance" }, sector: "dead-tide", at: [-5841, -5620], snap: "island", radius: 60 },
  // Planned: the bases of the chapters to come.
  // M02, "The People We Saved": the fishing village, the narrows, the Free Bay.
  { id: "tikhiy-list", name: { ru: "Тихий Лист", en: "Тихий Лист" }, sector: "dead-tide", at: [-7600, -2582], snap: "island", radius: 140 },
  { id: "green-spit", name: { ru: "Зелёная Коса", en: "The Green Spit" }, sector: "dead-tide", at: [-5920, -1850], snap: "point", radius: 120 },
  { id: "free-bay", name: { ru: "Бухта свободных", en: "The Free Bay" }, sector: "dead-tide", at: [-4463, -3420], snap: "point", radius: 120, charted: true },
  // M03, "Dead Water": the Sunny Cape's pier, the Laguna-4 water station at the island's south end.
  { id: "sunny-cape", name: { ru: "Солнечный мыс", en: "The Sunny Cape" }, sector: "dead-tide", at: [-3385, -4875], snap: "point", radius: 60, charted: true },
  { id: "laguna-4", name: { ru: "Станция «Лагуна-4»", en: "Laguna-4 station" }, sector: "dead-tide", at: [-3375, -5075], snap: "point", radius: 60 },
  { id: "pepel-relay", name: { ru: "Узел связи «Пепел»", en: "The Ash relay" }, sector: "green-squall", at: [-4758, 3253], snap: "island", radius: 200 },
  { id: "object-404", name: { ru: "«Объект-404»", en: "Object 404" }, sector: "sand-teeth", at: [1458, -4996], snap: "island", radius: 200 },
  { id: "last-frontier", name: { ru: "Маяк «Последний рубеж»", en: "Last Frontier light" }, sector: "open-wedge", at: [-9700, 1250], snap: "water", radius: 200 },
  { id: "command-center", name: { ru: "Командный центр «Аквилон»", en: "Aquilon command centre" }, sector: "black-caldera", at: [-856, -14], snap: "island", radius: 300 },
];
