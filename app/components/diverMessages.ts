import type { LanguageCode } from "./i18n";

/**
 * Words for the skipper on foot and in the water, in all thirty languages:
 * leaving and taking the helm, climbing aboard, the dive gauges, the torch
 * and the controls hint.
 */
export type DiverMessages = {
  leaveHelm: string;
  takeHelm: string;
  backToHelm: string;
  board: string;
  depth: string;
  air: string;
  lowAir: string;
  torch: string;
  jump: string;
  up: string;
  down: string;
  onDeck: string;
  swimming: string;
  diving: string;
  /** On his feet on an island, and knee- or waist-deep in the shallows. */
  ashore: string;
  wading: string;
  hintKeys: string;
  hintTouch: string;
  clickToLook: string;
  /** Units for the gauges. */
  metres?: string;
  bar?: string;
};

const EN: BaseDiverMessages = {
  leaveHelm: "Leave the helm",
  takeHelm: "Take the helm",
  backToHelm: "Back to the helm",
  board: "Climb aboard",
  depth: "Depth",
  air: "Air",
  lowAir: "Low air — surface",
  torch: "Torch",
  jump: "Jump",
  up: "Up",
  down: "Down",
  onDeck: "On deck",
  swimming: "Swimming",
  diving: "Diving",
  hintKeys: "WASD move · mouse look · Space jump / up · C down · Shift faster · E use · F torch · T helm · H all controls",
  hintTouch: "Left stick to move · drag to look · buttons to rise, dive and use",
  clickToLook: "Click to look around with the mouse",
};

/** Ashore and wading, in every language (merged into the tables below). */
const ON_FOOT: Record<LanguageCode, [string, string]> = {
  en: ["Ashore", "Wading"],
  zh: ["上岸", "涉水"],
  hi: ["किनारे पर", "पानी में चलना"],
  es: ["En tierra", "Vadeando"],
  fr: ["À terre", "Dans l'eau"],
  ar: ["على الشاطئ", "خوض في الماء"],
  bn: ["তীরে", "জলে হাঁটা"],
  pt: ["Em terra", "Na água rasa"],
  ru: ["На берегу", "Вброд"],
  ur: ["ساحل پر", "پانی میں چلنا"],
  id: ["Di darat", "Mengarungi air"],
  de: ["An Land", "Im Wasser watend"],
  ja: ["上陸", "浅瀬"],
  sw: ["Ufukweni", "Majini kwa miguu"],
  mr: ["किनाऱ्यावर", "पाण्यातून चालणे"],
  te: ["ఒడ్డున", "నీటిలో నడక"],
  tr: ["Karada", "Suda yürüyüş"],
  ta: ["கரையில்", "நீரில் நடை"],
  vi: ["Trên bờ", "Lội nước"],
  ko: ["상륙", "얕은 물"],
  it: ["A terra", "In acqua bassa"],
  fa: ["در ساحل", "راه رفتن در آب"],
  pl: ["Na lądzie", "Brodzenie"],
  uk: ["На березі", "Вбрід"],
  nl: ["Aan land", "Waden"],
  th: ["บนฝั่ง", "ลุยน้ำ"],
  gu: ["કિનારે", "પાણીમાં ચાલવું"],
  fil: ["Nasa pampang", "Lumulusong"],
  ms: ["Di darat", "Meranduk air"],
  he: ["על החוף", "הליכה במים"],
};

type BaseDiverMessages = Omit<DiverMessages, "ashore" | "wading">;

const MESSAGES: Partial<Record<LanguageCode, BaseDiverMessages>> = {
  en: EN,
  ru: {
    leaveHelm: "Выйти из-за штурвала",
    takeHelm: "Встать за штурвал",
    backToHelm: "Вернуться к штурвалу",
    board: "Подняться на борт",
    depth: "Глубина",
    air: "Воздух",
    lowAir: "Мало воздуха — всплывайте",
    torch: "Фонарь",
    jump: "Прыжок",
    up: "Вверх",
    down: "Вниз",
    onDeck: "На палубе",
    swimming: "Плавание",
    diving: "Погружение",
    hintKeys: "WASD — движение · мышь — обзор · Пробел — прыжок / вверх · C — вниз · Shift — быстрее · E — действие · F — фонарь · T — к штурвалу · H — всё управление",
    hintTouch: "Левый джойстик — движение · перетаскивание — обзор · кнопки — всплыть, нырнуть, действие",
    clickToLook: "Щёлкните, чтобы осматриваться мышью",
    metres: "м",
    bar: "бар",
  },
  zh: {
    leaveHelm: "离开舵位", takeHelm: "掌舵", backToHelm: "回到舵位", board: "登船", depth: "深度", air: "空气", lowAir: "空气不足——请上浮", torch: "手电", jump: "跳", up: "上浮", down: "下潜", onDeck: "在甲板上", swimming: "游泳", diving: "潜水",
    hintKeys: "WASD 移动 · 鼠标 视角 · 空格 跳/上浮 · C 下潜 · Shift 加速 · E 互动 · F 手电 · T 舵位", hintTouch: "左摇杆移动 · 拖动查看 · 按钮上浮、下潜、互动", clickToLook: "点击以用鼠标环顾四周",
  },
  hi: {
    leaveHelm: "पतवार छोड़ें", takeHelm: "पतवार संभालें", backToHelm: "पतवार पर लौटें", board: "नाव पर चढ़ें", depth: "गहराई", air: "हवा", lowAir: "हवा कम — ऊपर जाएँ", torch: "टॉर्च", jump: "कूदें", up: "ऊपर", down: "नीचे", onDeck: "डेक पर", swimming: "तैराकी", diving: "गोताखोरी",
    hintKeys: "WASD चलें · माउस देखें · Space कूदें / ऊपर · C नीचे · Shift तेज़ · E उपयोग · F टॉर्च · T पतवार", hintTouch: "बायाँ स्टिक चलने के लिए · खींचकर देखें · बटन ऊपर, नीचे, उपयोग", clickToLook: "माउस से देखने के लिए क्लिक करें",
  },
  es: {
    leaveHelm: "Dejar el timón", takeHelm: "Tomar el timón", backToHelm: "Volver al timón", board: "Subir a bordo", depth: "Profundidad", air: "Aire", lowAir: "Poco aire: sube", torch: "Linterna", jump: "Saltar", up: "Subir", down: "Bajar", onDeck: "En cubierta", swimming: "Nadando", diving: "Buceando",
    hintKeys: "WASD mover · ratón mirar · Espacio saltar / subir · C bajar · Mayús rápido · E usar · F linterna · T timón", hintTouch: "Stick izquierdo para moverse · arrastra para mirar · botones para subir, bajar y usar", clickToLook: "Haz clic para mirar con el ratón",
  },
  fr: {
    leaveHelm: "Quitter la barre", takeHelm: "Prendre la barre", backToHelm: "Retour à la barre", board: "Remonter à bord", depth: "Profondeur", air: "Air", lowAir: "Air bas — remontez", torch: "Lampe", jump: "Sauter", up: "Monter", down: "Descendre", onDeck: "Sur le pont", swimming: "À la nage", diving: "En plongée",
    hintKeys: "ZQSD/WASD bouger · souris regarder · Espace sauter / monter · C descendre · Maj plus vite · E utiliser · F lampe · T barre", hintTouch: "Joystick gauche pour bouger · glisser pour regarder · boutons pour monter, plonger, utiliser", clickToLook: "Cliquez pour regarder avec la souris",
  },
  ar: {
    leaveHelm: "اترك الدفة", takeHelm: "تولَّ الدفة", backToHelm: "العودة إلى الدفة", board: "اصعد إلى القارب", depth: "العمق", air: "الهواء", lowAir: "الهواء منخفض — اصعد", torch: "مصباح", jump: "قفز", up: "صعود", down: "نزول", onDeck: "على السطح", swimming: "سباحة", diving: "غوص",
    hintKeys: "WASD تحرك · الفأرة نظر · Space قفز / صعود · C نزول · Shift أسرع · E استخدام · F مصباح · T الدفة", hintTouch: "العصا اليسرى للحركة · اسحب للنظر · الأزرار للصعود والغوص والاستخدام", clickToLook: "انقر للنظر بالفأرة",
  },
  bn: {
    leaveHelm: "হাল ছাড়ুন", takeHelm: "হাল ধরুন", backToHelm: "হালে ফিরুন", board: "নৌকায় উঠুন", depth: "গভীরতা", air: "বাতাস", lowAir: "বাতাস কম — উপরে উঠুন", torch: "টর্চ", jump: "লাফ", up: "উপরে", down: "নিচে", onDeck: "ডেকে", swimming: "সাঁতার", diving: "ডুব",
    hintKeys: "WASD চলা · মাউস দেখা · Space লাফ / উপরে · C নিচে · Shift দ্রুত · E ব্যবহার · F টর্চ · T হাল", hintTouch: "বাম স্টিকে চলুন · টেনে দেখুন · বোতামে উঠুন, ডুবুন, ব্যবহার করুন", clickToLook: "মাউস দিয়ে দেখতে ক্লিক করুন",
  },
  pt: {
    leaveHelm: "Deixar o leme", takeHelm: "Assumir o leme", backToHelm: "Voltar ao leme", board: "Subir a bordo", depth: "Profundidade", air: "Ar", lowAir: "Pouco ar — suba", torch: "Lanterna", jump: "Pular", up: "Subir", down: "Descer", onDeck: "No convés", swimming: "Nadando", diving: "Mergulhando",
    hintKeys: "WASD mover · mouse olhar · Espaço pular / subir · C descer · Shift rápido · E usar · F lanterna · T leme", hintTouch: "Stick esquerdo para mover · arraste para olhar · botões para subir, descer e usar", clickToLook: "Clique para olhar com o mouse",
  },
  ur: {
    leaveHelm: "پتوار چھوڑیں", takeHelm: "پتوار سنبھالیں", backToHelm: "پتوار پر واپس", board: "کشتی پر چڑھیں", depth: "گہرائی", air: "ہوا", lowAir: "ہوا کم — اوپر جائیں", torch: "ٹارچ", jump: "چھلانگ", up: "اوپر", down: "نیچے", onDeck: "عرشے پر", swimming: "تیراکی", diving: "غوطہ",
    hintKeys: "WASD چلیں · ماؤس دیکھیں · Space چھلانگ / اوپر · C نیچے · Shift تیز · E استعمال · F ٹارچ · T پتوار", hintTouch: "بائیں اسٹک سے چلیں · گھسیٹ کر دیکھیں · بٹن اوپر، نیچے، استعمال", clickToLook: "ماؤس سے دیکھنے کے لیے کلک کریں",
  },
  id: {
    leaveHelm: "Tinggalkan kemudi", takeHelm: "Pegang kemudi", backToHelm: "Kembali ke kemudi", board: "Naik ke kapal", depth: "Kedalaman", air: "Udara", lowAir: "Udara menipis — naik", torch: "Senter", jump: "Lompat", up: "Naik", down: "Turun", onDeck: "Di dek", swimming: "Berenang", diving: "Menyelam",
    hintKeys: "WASD gerak · mouse lihat · Spasi lompat / naik · C turun · Shift cepat · E gunakan · F senter · T kemudi", hintTouch: "Stik kiri untuk bergerak · seret untuk melihat · tombol untuk naik, turun, gunakan", clickToLook: "Klik untuk melihat dengan mouse",
  },
  de: {
    leaveHelm: "Ruder verlassen", takeHelm: "Ans Ruder", backToHelm: "Zurück ans Ruder", board: "An Bord klettern", depth: "Tiefe", air: "Luft", lowAir: "Wenig Luft — auftauchen", torch: "Lampe", jump: "Springen", up: "Hoch", down: "Runter", onDeck: "An Deck", swimming: "Schwimmen", diving: "Tauchen",
    hintKeys: "WASD bewegen · Maus umsehen · Leertaste springen / hoch · C runter · Umschalt schneller · E benutzen · F Lampe · T Ruder", hintTouch: "Linker Stick bewegen · Ziehen zum Umsehen · Tasten zum Auftauchen, Abtauchen, Benutzen", clickToLook: "Klicken, um mit der Maus umzusehen",
  },
  ja: {
    leaveHelm: "舵を離れる", takeHelm: "舵を取る", backToHelm: "舵に戻る", board: "船に上がる", depth: "深さ", air: "空気", lowAir: "空気残量わずか — 浮上", torch: "ライト", jump: "ジャンプ", up: "浮上", down: "潜る", onDeck: "甲板", swimming: "水泳", diving: "ダイビング",
    hintKeys: "WASD 移動 · マウス 視点 · Space ジャンプ/浮上 · C 潜る · Shift 速く · E 使う · F ライト · T 舵", hintTouch: "左スティックで移動 · ドラッグで視点 · ボタンで浮上・潜行・使用", clickToLook: "クリックしてマウスで見回す",
  },
  sw: {
    leaveHelm: "Acha usukani", takeHelm: "Shika usukani", backToHelm: "Rudi usukanini", board: "Panda chomboni", depth: "Kina", air: "Hewa", lowAir: "Hewa kidogo — panda juu", torch: "Tochi", jump: "Ruka", up: "Juu", down: "Chini", onDeck: "Sitahani", swimming: "Kuogelea", diving: "Kupiga mbizi",
    hintKeys: "WASD kusogea · kipanya kuangalia · Space ruka / juu · C chini · Shift haraka · E tumia · F tochi · T usukani", hintTouch: "Kijiti cha kushoto kusogea · buruta kuangalia · vitufe kupanda, kuzama, kutumia", clickToLook: "Bofya kuangalia kwa kipanya",
  },
  mr: {
    leaveHelm: "सुकाणू सोडा", takeHelm: "सुकाणू धरा", backToHelm: "सुकाणूकडे परत", board: "बोटीवर चढा", depth: "खोली", air: "हवा", lowAir: "हवा कमी — वर या", torch: "टॉर्च", jump: "उडी", up: "वर", down: "खाली", onDeck: "डेकवर", swimming: "पोहणे", diving: "डुबकी",
    hintKeys: "WASD हालचाल · माउस पाहणे · Space उडी / वर · C खाली · Shift वेगाने · E वापर · F टॉर्च · T सुकाणू", hintTouch: "डावी स्टिक हालचालीसाठी · ओढून पाहा · बटणे वर, खाली, वापर", clickToLook: "माउसने पाहण्यासाठी क्लिक करा",
  },
  te: {
    leaveHelm: "చుక్కాని వదలండి", takeHelm: "చుక్కాని పట్టండి", backToHelm: "చుక్కానికి తిరిగి", board: "పడవ ఎక్కండి", depth: "లోతు", air: "గాలి", lowAir: "గాలి తక్కువ — పైకి రండి", torch: "టార్చ్", jump: "దూకు", up: "పైకి", down: "కిందకు", onDeck: "డెక్‌పై", swimming: "ఈత", diving: "డైవింగ్",
    hintKeys: "WASD కదలిక · మౌస్ చూడటం · Space దూకు / పైకి · C కిందకు · Shift వేగం · E ఉపయోగం · F టార్చ్ · T చుక్కాని", hintTouch: "ఎడమ స్టిక్‌తో కదలండి · లాగి చూడండి · బటన్లు పైకి, కిందకు, ఉపయోగం", clickToLook: "మౌస్‌తో చూడటానికి క్లిక్ చేయండి",
  },
  tr: {
    leaveHelm: "Dümeni bırak", takeHelm: "Dümene geç", backToHelm: "Dümene dön", board: "Tekneye çık", depth: "Derinlik", air: "Hava", lowAir: "Hava az — yüzeye çık", torch: "Fener", jump: "Zıpla", up: "Yukarı", down: "Aşağı", onDeck: "Güvertede", swimming: "Yüzme", diving: "Dalış",
    hintKeys: "WASD hareket · fare bakış · Boşluk zıpla / yukarı · C aşağı · Shift hızlı · E kullan · F fener · T dümen", hintTouch: "Sol çubukla hareket · sürükleyerek bak · düğmelerle çık, dal, kullan", clickToLook: "Fareyle bakmak için tıklayın",
  },
  ta: {
    leaveHelm: "சுக்கானை விடு", takeHelm: "சுக்கானைப் பிடி", backToHelm: "சுக்கானுக்குத் திரும்பு", board: "படகில் ஏறு", depth: "ஆழம்", air: "காற்று", lowAir: "காற்று குறைவு — மேலே வா", torch: "டார்ச்", jump: "தாவு", up: "மேலே", down: "கீழே", onDeck: "தளத்தில்", swimming: "நீச்சல்", diving: "முக்குளிப்பு",
    hintKeys: "WASD நகர்வு · சுட்டி பார்வை · Space தாவு / மேலே · C கீழே · Shift வேகம் · E பயன் · F டார்ச் · T சுக்கான்", hintTouch: "இடது குச்சியால் நகர் · இழுத்துப் பார் · பொத்தான்கள் மேலே, கீழே, பயன்", clickToLook: "சுட்டியால் பார்க்க கிளிக் செய்யவும்",
  },
  vi: {
    leaveHelm: "Rời tay lái", takeHelm: "Cầm lái", backToHelm: "Về tay lái", board: "Lên thuyền", depth: "Độ sâu", air: "Khí", lowAir: "Sắp hết khí — nổi lên", torch: "Đèn pin", jump: "Nhảy", up: "Lên", down: "Xuống", onDeck: "Trên boong", swimming: "Bơi", diving: "Lặn",
    hintKeys: "WASD di chuyển · chuột nhìn · Space nhảy / lên · C xuống · Shift nhanh · E dùng · F đèn · T tay lái", hintTouch: "Cần trái để di chuyển · kéo để nhìn · nút để lên, lặn, dùng", clickToLook: "Nhấp để nhìn quanh bằng chuột",
  },
  ko: {
    leaveHelm: "키에서 떠나기", takeHelm: "키 잡기", backToHelm: "키로 돌아가기", board: "배에 오르기", depth: "수심", air: "공기", lowAir: "공기 부족 — 상승하세요", torch: "손전등", jump: "점프", up: "상승", down: "하강", onDeck: "갑판", swimming: "수영", diving: "다이빙",
    hintKeys: "WASD 이동 · 마우스 시점 · Space 점프/상승 · C 하강 · Shift 빠르게 · E 사용 · F 손전등 · T 키", hintTouch: "왼쪽 스틱 이동 · 드래그로 보기 · 버튼으로 상승, 하강, 사용", clickToLook: "클릭하여 마우스로 둘러보기",
  },
  it: {
    leaveHelm: "Lascia il timone", takeHelm: "Prendi il timone", backToHelm: "Torna al timone", board: "Sali a bordo", depth: "Profondità", air: "Aria", lowAir: "Poca aria — risali", torch: "Torcia", jump: "Salta", up: "Su", down: "Giù", onDeck: "In coperta", swimming: "A nuoto", diving: "In immersione",
    hintKeys: "WASD muovi · mouse guarda · Spazio salta / su · C giù · Maiusc veloce · E usa · F torcia · T timone", hintTouch: "Stick sinistro per muoverti · trascina per guardare · pulsanti per salire, scendere, usare", clickToLook: "Fai clic per guardarti intorno col mouse",
  },
  fa: {
    leaveHelm: "ترک سکان", takeHelm: "گرفتن سکان", backToHelm: "بازگشت به سکان", board: "سوار قایق شو", depth: "عمق", air: "هوا", lowAir: "هوا کم است — بالا بیا", torch: "چراغ قوه", jump: "پرش", up: "بالا", down: "پایین", onDeck: "روی عرشه", swimming: "شنا", diving: "غواصی",
    hintKeys: "WASD حرکت · ماوس دید · Space پرش / بالا · C پایین · Shift سریع · E استفاده · F چراغ · T سکان", hintTouch: "اهرم چپ برای حرکت · بکشید برای دید · دکمه‌ها برای بالا، پایین، استفاده", clickToLook: "برای نگاه با ماوس کلیک کنید",
  },
  pl: {
    leaveHelm: "Odejdź od steru", takeHelm: "Przejmij ster", backToHelm: "Wróć do steru", board: "Wejdź na pokład", depth: "Głębokość", air: "Powietrze", lowAir: "Mało powietrza — wynurz się", torch: "Latarka", jump: "Skok", up: "W górę", down: "W dół", onDeck: "Na pokładzie", swimming: "Pływanie", diving: "Nurkowanie",
    hintKeys: "WASD ruch · mysz rozglądanie · Spacja skok / w górę · C w dół · Shift szybciej · E użyj · F latarka · T ster", hintTouch: "Lewa gałka ruch · przeciągnij, by się rozglądać · przyciski: w górę, w dół, użyj", clickToLook: "Kliknij, aby rozglądać się myszą",
  },
  uk: {
    leaveHelm: "Відійти від штурвала", takeHelm: "Стати за штурвал", backToHelm: "Повернутися до штурвала", board: "Піднятися на борт", depth: "Глибина", air: "Повітря", lowAir: "Мало повітря — спливайте", torch: "Ліхтар", jump: "Стрибок", up: "Вгору", down: "Вниз", onDeck: "На палубі", swimming: "Плавання", diving: "Занурення",
    hintKeys: "WASD — рух · миша — огляд · Пробіл — стрибок / вгору · C — вниз · Shift — швидше · E — дія · F — ліхтар · T — до штурвала", hintTouch: "Лівий джойстик — рух · перетягування — огляд · кнопки — спливти, пірнути, дія", clickToLook: "Клацніть, щоб оглядатися мишею", metres: "м", bar: "бар",
  },
  nl: {
    leaveHelm: "Roer verlaten", takeHelm: "Roer nemen", backToHelm: "Terug naar het roer", board: "Aan boord klimmen", depth: "Diepte", air: "Lucht", lowAir: "Weinig lucht — naar boven", torch: "Zaklamp", jump: "Springen", up: "Omhoog", down: "Omlaag", onDeck: "Aan dek", swimming: "Zwemmen", diving: "Duiken",
    hintKeys: "WASD bewegen · muis kijken · Spatie springen / omhoog · C omlaag · Shift sneller · E gebruiken · F lamp · T roer", hintTouch: "Linker stick bewegen · slepen om te kijken · knoppen omhoog, omlaag, gebruiken", clickToLook: "Klik om met de muis rond te kijken",
  },
  th: {
    leaveHelm: "ออกจากพวงมาลัย", takeHelm: "จับพวงมาลัย", backToHelm: "กลับไปที่พวงมาลัย", board: "ขึ้นเรือ", depth: "ความลึก", air: "อากาศ", lowAir: "อากาศเหลือน้อย — ขึ้นผิวน้ำ", torch: "ไฟฉาย", jump: "กระโดด", up: "ขึ้น", down: "ลง", onDeck: "บนดาดฟ้า", swimming: "ว่ายน้ำ", diving: "ดำน้ำ",
    hintKeys: "WASD เดิน · เมาส์ มอง · Space กระโดด/ขึ้น · C ลง · Shift เร็ว · E ใช้ · F ไฟฉาย · T พวงมาลัย", hintTouch: "จอยซ้ายเพื่อเคลื่อนที่ · ลากเพื่อมอง · ปุ่มขึ้น ลง ใช้", clickToLook: "คลิกเพื่อมองรอบด้วยเมาส์",
  },
  gu: {
    leaveHelm: "સુકાન છોડો", takeHelm: "સુકાન સંભાળો", backToHelm: "સુકાન પર પાછા", board: "હોડી પર ચઢો", depth: "ઊંડાઈ", air: "હવા", lowAir: "હવા ઓછી — ઉપર આવો", torch: "ટોર્ચ", jump: "કૂદકો", up: "ઉપર", down: "નીચે", onDeck: "ડેક પર", swimming: "તરવું", diving: "ડૂબકી",
    hintKeys: "WASD ચાલો · માઉસ જુઓ · Space કૂદકો / ઉપર · C નીચે · Shift ઝડપી · E વાપરો · F ટોર્ચ · T સુકાન", hintTouch: "ડાબી સ્ટિકથી ચાલો · ખેંચીને જુઓ · બટન ઉપર, નીચે, વાપરો", clickToLook: "માઉસથી જોવા ક્લિક કરો",
  },
  fil: {
    leaveHelm: "Iwan ang timon", takeHelm: "Hawakan ang timon", backToHelm: "Bumalik sa timon", board: "Umakyat sa bangka", depth: "Lalim", air: "Hangin", lowAir: "Kaunti na ang hangin — umahon", torch: "Flashlight", jump: "Tumalon", up: "Taas", down: "Baba", onDeck: "Sa kubyerta", swimming: "Lumalangoy", diving: "Sumisisid",
    hintKeys: "WASD galaw · mouse tingin · Space talon / taas · C baba · Shift bilis · E gamit · F ilaw · T timon", hintTouch: "Kaliwang stick para gumalaw · i-drag para tumingin · mga button para umahon, sumisid, gumamit", clickToLook: "I-click para tumingin gamit ang mouse",
  },
  ms: {
    leaveHelm: "Tinggalkan kemudi", takeHelm: "Pegang kemudi", backToHelm: "Kembali ke kemudi", board: "Naik ke bot", depth: "Kedalaman", air: "Udara", lowAir: "Udara rendah — naik", torch: "Lampu suluh", jump: "Lompat", up: "Naik", down: "Turun", onDeck: "Di dek", swimming: "Berenang", diving: "Menyelam",
    hintKeys: "WASD gerak · tetikus lihat · Space lompat / naik · C turun · Shift laju · E guna · F lampu · T kemudi", hintTouch: "Kayu bedik kiri untuk bergerak · seret untuk melihat · butang naik, turun, guna", clickToLook: "Klik untuk melihat dengan tetikus",
  },
  he: {
    leaveHelm: "עזוב את ההגה", takeHelm: "קח את ההגה", backToHelm: "חזרה להגה", board: "עלה לסירה", depth: "עומק", air: "אוויר", lowAir: "מעט אוויר — עלה", torch: "פנס", jump: "קפיצה", up: "למעלה", down: "למטה", onDeck: "על הסיפון", swimming: "שחייה", diving: "צלילה",
    hintKeys: "WASD תנועה · עכבר מבט · Space קפיצה / למעלה · C למטה · Shift מהר · E שימוש · F פנס · T הגה", hintTouch: "ג׳ויסטיק שמאלי לתנועה · גרירה למבט · כפתורים לעלייה, צלילה, שימוש", clickToLook: "לחץ כדי להסתכל עם העכבר",
  },
};

export function getDiverMessages(language: LanguageCode): DiverMessages {
  const [ashore, wading] = ON_FOOT[language] ?? ON_FOOT.en;
  return { ...(MESSAGES[language] ?? EN), ashore, wading };
}

/** Every language has the full set (checked by the tests). */
export const DIVER_LANGUAGES = Object.keys(MESSAGES) as LanguageCode[];
