import type { LanguageCode } from "./i18n";
import type { BindingAction } from "@/src/simulator/input/KeyBindings";

/**
 * Words of the pause menu (Esc on foot): its pages, the key bindings and
 * the mouse, in all thirty languages. The quality names, "Language",
 * "Controls" and "Back to the helm" come from the existing tables.
 */
export type PauseMessages = {
  paused: string;
  resume: string;
  graphics: string;
  keys: string;
  back: string;
  pressKey: string;
  resetKeys: string;
  sensitivity: string;
  invertY: string;
  actions: Record<BindingAction, string>;
};

type Row = readonly [
  paused: string,
  resume: string,
  graphics: string,
  keys: string,
  back: string,
  pressKey: string,
  resetKeys: string,
  sensitivity: string,
  invertY: string,
  forward: string,
  backward: string,
  left: string,
  right: string,
  jump: string,
  sprint: string,
  crouch: string,
  interact: string,
  torch: string,
  chart: string,
  backpack: string,
  helm: string,
];

const ROWS: Record<LanguageCode, Row> = {
  en: ["Paused", "Resume", "Graphics", "Key bindings", "Back", "Press a key… (Esc to cancel)", "Restore defaults", "Mouse sensitivity", "Invert vertical look", "Forward", "Backward", "Left", "Right", "Jump / swim up", "Sprint", "Swim down", "Use / talk", "Torch", "Chart", "Backpack", "Back to the helm"],
  zh: ["已暂停", "继续", "画面", "按键设置", "返回", "请按下一个键…（Esc 取消）", "恢复默认", "鼠标灵敏度", "反转垂直视角", "前进", "后退", "向左", "向右", "跳跃 / 上浮", "冲刺", "下潜", "使用 / 交谈", "手电", "海图", "背包", "回到舵位"],
  hi: ["रुका हुआ", "जारी रखें", "ग्राफ़िक्स", "कुंजी सेटिंग", "वापस", "कोई कुंजी दबाएँ… (Esc रद्द करे)", "डिफ़ॉल्ट बहाल करें", "माउस संवेदनशीलता", "ऊर्ध्व दृश्य उलटें", "आगे", "पीछे", "बाएँ", "दाएँ", "कूदें / ऊपर तैरें", "दौड़ें", "नीचे तैरें", "उपयोग / बात", "टॉर्च", "नक्शा", "बैग", "पतवार पर लौटें"],
  es: ["En pausa", "Continuar", "Gráficos", "Teclas", "Atrás", "Pulsa una tecla… (Esc cancela)", "Restaurar valores", "Sensibilidad del ratón", "Invertir vista vertical", "Adelante", "Atrás", "Izquierda", "Derecha", "Saltar / subir", "Correr", "Bucear hacia abajo", "Usar / hablar", "Linterna", "Carta náutica", "Mochila", "Volver al timón"],
  fr: ["En pause", "Reprendre", "Graphismes", "Touches", "Retour", "Appuyez sur une touche… (Échap annule)", "Rétablir par défaut", "Sensibilité de la souris", "Inverser l’axe vertical", "Avancer", "Reculer", "Gauche", "Droite", "Sauter / remonter", "Sprint", "Descendre", "Utiliser / parler", "Lampe", "Carte", "Sac à dos", "Retour à la barre"],
  ar: ["متوقف مؤقتًا", "متابعة", "الرسوميات", "المفاتيح", "رجوع", "اضغط مفتاحًا… (Esc للإلغاء)", "استعادة الافتراضي", "حساسية الفأرة", "عكس النظر العمودي", "للأمام", "للخلف", "يسار", "يمين", "قفز / صعود", "ركض", "غوص للأسفل", "استخدام / تحدث", "مصباح", "الخريطة", "حقيبة الظهر", "العودة إلى الدفة"],
  bn: ["বিরতি", "চালিয়ে যান", "গ্রাফিক্স", "কী সেটিং", "ফিরে যান", "একটি কী চাপুন… (Esc বাতিল)", "ডিফল্টে ফেরান", "মাউস সংবেদনশীলতা", "উল্লম্ব দৃষ্টি উল্টান", "সামনে", "পিছনে", "বামে", "ডানে", "লাফ / উপরে সাঁতার", "দৌড়", "নিচে সাঁতার", "ব্যবহার / কথা", "টর্চ", "মানচিত্র", "ব্যাকপ্যাক", "হালে ফিরুন"],
  pt: ["Pausado", "Continuar", "Gráficos", "Teclas", "Voltar", "Pressione uma tecla… (Esc cancela)", "Restaurar padrão", "Sensibilidade do mouse", "Inverter visão vertical", "Frente", "Trás", "Esquerda", "Direita", "Pular / subir", "Correr", "Mergulhar", "Usar / falar", "Lanterna", "Carta náutica", "Mochila", "Voltar ao leme"],
  ru: ["Пауза", "Продолжить", "Графика", "Управление клавишами", "Назад", "Нажмите клавишу… (Esc — отмена)", "Сбросить по умолчанию", "Чувствительность мыши", "Инвертировать по вертикали", "Вперёд", "Назад", "Влево", "Вправо", "Прыжок / всплыть", "Бег", "Нырнуть", "Действие / говорить", "Фонарь", "Карта", "Рюкзак", "К штурвалу"],
  ur: ["رکا ہوا", "جاری رکھیں", "گرافکس", "کلیدیں", "واپس", "کوئی کلید دبائیں… (Esc منسوخ)", "پہلے سے طے شدہ بحال کریں", "ماؤس کی حساسیت", "عمودی نظر الٹائیں", "آگے", "پیچھے", "بائیں", "دائیں", "چھلانگ / اوپر تیریں", "دوڑ", "نیچے تیریں", "استعمال / بات", "ٹارچ", "نقشہ", "بستہ", "پتوار پر واپس"],
  id: ["Dijeda", "Lanjutkan", "Grafis", "Tombol", "Kembali", "Tekan tombol… (Esc batal)", "Kembalikan bawaan", "Kepekaan mouse", "Balik pandangan vertikal", "Maju", "Mundur", "Kiri", "Kanan", "Lompat / naik", "Lari", "Menyelam turun", "Gunakan / bicara", "Senter", "Peta laut", "Ransel", "Kembali ke kemudi"],
  de: ["Pausiert", "Weiter", "Grafik", "Tastenbelegung", "Zurück", "Taste drücken … (Esc bricht ab)", "Standard wiederherstellen", "Mausempfindlichkeit", "Vertikale Sicht umkehren", "Vorwärts", "Rückwärts", "Links", "Rechts", "Springen / auftauchen", "Sprinten", "Abtauchen", "Benutzen / sprechen", "Lampe", "Seekarte", "Rucksack", "Zurück ans Steuer"],
  ja: ["一時停止中", "再開", "グラフィック", "キー設定", "戻る", "キーを押してください…（Esc で取消）", "初期設定に戻す", "マウス感度", "上下の視点を反転", "前進", "後退", "左", "右", "ジャンプ / 浮上", "ダッシュ", "潜る", "使う / 話す", "ライト", "海図", "バックパック", "舵に戻る"],
  sw: ["Imesitishwa", "Endelea", "Michoro", "Vitufe", "Rudi", "Bonyeza kitufe… (Esc kughairi)", "Rejesha chaguo-msingi", "Unyeti wa kipanya", "Geuza mtazamo wima", "Mbele", "Nyuma", "Kushoto", "Kulia", "Ruka / panda juu", "Kimbia", "Zama chini", "Tumia / ongea", "Tochi", "Ramani", "Mkoba", "Rudi kwenye usukani"],
  mr: ["थांबवले", "पुढे सुरू ठेवा", "ग्राफिक्स", "की सेटिंग", "मागे", "एक की दाबा… (Esc रद्द)", "मूळ सेटिंग परत", "माउस संवेदनशीलता", "उभा दृष्टिकोन उलटा", "पुढे", "मागे", "डावीकडे", "उजवीकडे", "उडी / वर पोहा", "धाव", "खाली पोहा", "वापरा / बोला", "टॉर्च", "नकाशा", "पाठपिशवी", "सुकाणूकडे परत"],
  te: ["విరామం", "కొనసాగించు", "గ్రాఫిక్స్", "కీలు", "వెనుకకు", "ఒక కీ నొక్కండి… (Esc రద్దు)", "డిఫాల్ట్‌లు పునరుద్ధరించు", "మౌస్ సున్నితత్వం", "నిలువు చూపు తిప్పు", "ముందుకు", "వెనుకకు", "ఎడమ", "కుడి", "దూకు / పైకి ఈదు", "పరుగు", "కిందకు ఈదు", "ఉపయోగించు / మాట్లాడు", "టార్చ్", "పటం", "బ్యాక్‌ప్యాక్", "చుక్కానికి తిరిగి"],
  tr: ["Duraklatıldı", "Devam et", "Grafik", "Tuşlar", "Geri", "Bir tuşa basın… (Esc iptal)", "Varsayılana dön", "Fare hassasiyeti", "Dikey bakışı ters çevir", "İleri", "Geri", "Sol", "Sağ", "Zıpla / yüksel", "Koş", "Dal", "Kullan / konuş", "Fener", "Harita", "Sırt çantası", "Dümene dön"],
  ta: ["இடைநிறுத்தம்", "தொடர்", "வரைகலை", "விசைகள்", "பின்", "ஒரு விசையை அழுத்தவும்… (Esc ரத்து)", "இயல்புநிலை மீட்டமை", "சுட்டி உணர்திறன்", "செங்குத்துப் பார்வையைத் திருப்பு", "முன்னே", "பின்னே", "இடது", "வலது", "குதி / மேலே நீந்து", "ஓட்டம்", "கீழே நீந்து", "பயன்படுத்து / பேசு", "டார்ச்", "வரைபடம்", "முதுகுப்பை", "சுக்கானுக்குத் திரும்பு"],
  vi: ["Tạm dừng", "Tiếp tục", "Đồ họa", "Phím", "Quay lại", "Nhấn một phím… (Esc để hủy)", "Khôi phục mặc định", "Độ nhạy chuột", "Đảo trục dọc", "Tiến", "Lùi", "Trái", "Phải", "Nhảy / bơi lên", "Chạy nhanh", "Lặn xuống", "Dùng / nói chuyện", "Đèn pin", "Hải đồ", "Ba lô", "Về tay lái"],
  ko: ["일시 정지", "계속", "그래픽", "키 설정", "뒤로", "키를 누르세요… (Esc 취소)", "기본값 복원", "마우스 감도", "세로 시점 반전", "앞으로", "뒤로", "왼쪽", "오른쪽", "점프 / 떠오르기", "달리기", "잠수", "사용 / 대화", "손전등", "해도", "배낭", "키로 돌아가기"],
  it: ["In pausa", "Riprendi", "Grafica", "Tasti", "Indietro", "Premi un tasto… (Esc annulla)", "Ripristina predefiniti", "Sensibilità del mouse", "Inverti visuale verticale", "Avanti", "Indietro", "Sinistra", "Destra", "Salta / risali", "Scatto", "Immergiti", "Usa / parla", "Torcia", "Carta nautica", "Zaino", "Torna al timone"],
  fa: ["مکث", "ادامه", "گرافیک", "کلیدها", "بازگشت", "یک کلید را فشار دهید… (Esc لغو)", "بازگردانی پیش‌فرض", "حساسیت ماوس", "وارونه کردن نگاه عمودی", "جلو", "عقب", "چپ", "راست", "پرش / بالا آمدن", "دویدن", "پایین رفتن", "استفاده / گفتگو", "چراغ‌قوه", "نقشه", "کوله‌پشتی", "بازگشت به سکان"],
  pl: ["Pauza", "Wznów", "Grafika", "Klawisze", "Wstecz", "Naciśnij klawisz… (Esc anuluje)", "Przywróć domyślne", "Czułość myszy", "Odwróć oś pionową", "Naprzód", "Wstecz", "W lewo", "W prawo", "Skok / wynurzenie", "Sprint", "Zanurzenie", "Użyj / rozmawiaj", "Latarka", "Mapa", "Plecak", "Wróć do steru"],
  uk: ["Пауза", "Продовжити", "Графіка", "Клавіші", "Назад", "Натисніть клавішу… (Esc — скасувати)", "Скинути до типових", "Чутливість миші", "Інвертувати по вертикалі", "Вперед", "Назад", "Ліворуч", "Праворуч", "Стрибок / спливти", "Біг", "Пірнути", "Дія / говорити", "Ліхтар", "Мапа", "Рюкзак", "До штурвала"],
  nl: ["Gepauzeerd", "Hervatten", "Graphics", "Toetsen", "Terug", "Druk op een toets… (Esc annuleert)", "Standaard herstellen", "Muisgevoeligheid", "Verticale blik omkeren", "Vooruit", "Achteruit", "Links", "Rechts", "Springen / omhoog", "Sprinten", "Duiken", "Gebruiken / praten", "Zaklamp", "Zeekaart", "Rugzak", "Terug naar het roer"],
  th: ["หยุดชั่วคราว", "เล่นต่อ", "กราฟิก", "ปุ่มควบคุม", "กลับ", "กดปุ่ม… (Esc ยกเลิก)", "คืนค่าเริ่มต้น", "ความไวเมาส์", "กลับทิศมองแนวตั้ง", "เดินหน้า", "ถอยหลัง", "ซ้าย", "ขวา", "กระโดด / ว่ายขึ้น", "วิ่ง", "ดำลง", "ใช้ / พูดคุย", "ไฟฉาย", "แผนที่", "เป้", "กลับไปที่พวงมาลัย"],
  gu: ["થોભાવેલ", "ચાલુ રાખો", "ગ્રાફિક્સ", "કી સેટિંગ", "પાછા", "કોઈ કી દબાવો… (Esc રદ)", "મૂળ સેટિંગ પાછી", "માઉસ સંવેદનશીલતા", "ઊભો દૃષ્ટિકોણ ઉલટાવો", "આગળ", "પાછળ", "ડાબે", "જમણે", "કૂદકો / ઉપર તરો", "દોડ", "નીચે તરો", "વાપરો / વાત", "ટોર્ચ", "નકશો", "બેગ", "સુકાન પર પાછા"],
  fil: ["Naka-pause", "Ituloy", "Grapiko", "Mga key", "Bumalik", "Pumindot ng key… (Esc para kanselahin)", "Ibalik ang default", "Sensitivity ng mouse", "Baligtarin ang patayong tingin", "Pasulong", "Paatras", "Kaliwa", "Kanan", "Tumalon / umahon", "Tumakbo", "Sumisid", "Gamitin / kausapin", "Flashlight", "Mapa", "Backpack", "Bumalik sa timon"],
  ms: ["Dijeda", "Sambung", "Grafik", "Kekunci", "Kembali", "Tekan kekunci… (Esc batal)", "Pulihkan lalai", "Kepekaan tetikus", "Terbalikkan pandangan menegak", "Ke depan", "Ke belakang", "Kiri", "Kanan", "Lompat / naik", "Pecut", "Selam ke bawah", "Guna / bercakap", "Lampu suluh", "Peta laut", "Beg galas", "Kembali ke kemudi"],
  he: ["מושהה", "המשך", "גרפיקה", "מקשים", "חזרה", "לחץ על מקש… (Esc לביטול)", "שחזור ברירת מחדל", "רגישות העכבר", "היפוך מבט אנכי", "קדימה", "אחורה", "שמאלה", "ימינה", "קפיצה / עלייה", "ריצה", "צלילה מטה", "שימוש / שיחה", "פנס", "מפה", "תרמיל", "חזרה להגה"],
};

export function getPauseMessages(language: LanguageCode): PauseMessages {
  const row = ROWS[language] ?? ROWS.en;
  const [paused, resume, graphics, keys, back, pressKey, resetKeys, sensitivity, invertY, forward, backward, left, right, jump, sprint, crouch, interact, torch, chart, backpack, helm] = row;
  return {
    paused,
    resume,
    graphics,
    keys,
    back,
    pressKey,
    resetKeys,
    sensitivity,
    invertY,
    actions: { forward, back: backward, left, right, jump, sprint, crouch, interact, torch, chart, backpack, helm },
  };
}

export const PAUSE_LANGUAGES = Object.keys(ROWS) as LanguageCode[];
