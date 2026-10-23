export const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "zh", name: "中文" },
  { code: "hi", name: "हिन्दी" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "ar", name: "العربية" },
  { code: "bn", name: "বাংলা" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "ur", name: "اردو" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "de", name: "Deutsch" },
  { code: "ja", name: "日本語" },
  { code: "sw", name: "Kiswahili" },
  { code: "mr", name: "मराठी" },
  { code: "te", name: "తెలుగు" },
  { code: "tr", name: "Türkçe" },
  { code: "ta", name: "தமிழ்" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "ko", name: "한국어" },
  { code: "it", name: "Italiano" },
  { code: "fa", name: "فارسی" },
  { code: "pl", name: "Polski" },
  { code: "uk", name: "Українська" },
  { code: "nl", name: "Nederlands" },
  { code: "th", name: "ไทย" },
  { code: "gu", name: "ગુજરાતી" },
  { code: "fil", name: "Filipino" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "he", name: "עברית" },
] as const;

export type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]["code"];

const ENGLISH_MESSAGES = {
  loadingTitle: "Preparing the tropical sea",
  loading: "Loading",
  rendererNotice: "Renderer notice",
  sceneInterrupted: "Scene interrupted",
  reload: "Reload simulator",
  speed: "Speed",
  depth: "Depth",
  apparentWind: "Apparent wind",
  heading: "Heading",
  controls: "Controls",
  sailingControls: "Sailing controls",
  credits: "3D credits",
  expand: "Expand control panel",
  minimize: "Minimize control panel",
  day: "Day",
  night: "Night",
  start: "Start",
  stop: "Stop",
  sound: "Sound",
  tapSound: "Tap for sound",
  engineSound: "Engine sound",
  camera: "Camera",
  chase: "Chase",
  helm: "Helm",
  orbit: "Orbit",
  drone: "Drone",
  sailTrim: "Sail trim",
  quality: "Quality",
  low: "Low",
  medium: "Medium",
  high: "High",
  reset: "Reset scene", photoMode: "Photo mode", photoModeHint: "Exit photo mode: Esc / double-tap",
  language: "Language",
  rudder: "Rudder",
  port: "Port",
  starboard: "Starboard",
  center: "Center",
  centerRudder: "Center rudder",
  engine: "Engine",
  on: "On",
  off: "Off",
  throttle: "Throttle",
  forward: "Fwd",
  reverse: "Rev",
  fullAhead: "Full ahead",
  halfAhead: "Half ahead",
  slowAhead: "Slow ahead",
  fullAstern: "Full astern",
  halfAstern: "Half astern",
  slowAstern: "Slow astern",
  neutral: "Neutral",
  help: "Swipe the sea to look · pinch to zoom · use rudder and throttle independently",
};

type CoreMessages = { [Key in keyof typeof ENGLISH_MESSAGES]: string };

const TRANSLATIONS: Record<LanguageCode, CoreMessages> = {
  en: ENGLISH_MESSAGES,
  zh: {
    loadingTitle: "正在准备热带海域", loading: "加载中", rendererNotice: "渲染器提示", sceneInterrupted: "场景已中断", reload: "重新加载模拟器",
    speed: "速度", depth: "水深", apparentWind: "视风", heading: "航向", controls: "控制", sailingControls: "航行控制", credits: "3D 模型鸣谢", expand: "展开控制面板", minimize: "收起控制面板",
    day: "白天", night: "夜晚", start: "启动", stop: "停止", sound: "声音", tapSound: "点击启用声音", engineSound: "发动机声音", camera: "相机", chase: "追随", helm: "舵位", orbit: "环绕", drone: "无人机",
    sailTrim: "帆调整", quality: "画质", low: "低", medium: "中", high: "高", reset: "重置场景", photoMode: "拍照模式", photoModeHint: "退出拍照：Esc / 双击海面", language: "语言", rudder: "船舵", port: "左舷", starboard: "右舷", center: "居中", centerRudder: "舵回中",
    engine: "发动机", on: "开", off: "关", throttle: "油门", forward: "前进", reverse: "后退", fullAhead: "全速前进", halfAhead: "半速前进", slowAhead: "慢速前进", fullAstern: "全速后退", halfAstern: "半速后退", slowAstern: "慢速后退", neutral: "空挡",
    help: "滑动海面查看 · 双指缩放 · 船舵与油门可独立控制",
  },
  hi: {
    loadingTitle: "उष्णकटिबंधीय समुद्र तैयार हो रहा है", loading: "लोड हो रहा है", rendererNotice: "रेंडरर सूचना", sceneInterrupted: "दृश्य रुक गया", reload: "सिम्युलेटर फिर लोड करें",
    speed: "गति", depth: "गहराई", apparentWind: "आभासी हवा", heading: "दिशा", controls: "नियंत्रण", sailingControls: "नौकायन नियंत्रण", credits: "3D श्रेय", expand: "कंट्रोल पैनल खोलें", minimize: "कंट्रोल पैनल छोटा करें",
    day: "दिन", night: "रात", start: "चालू", stop: "बंद", sound: "ध्वनि", tapSound: "ध्वनि के लिए टैप करें", engineSound: "इंजन ध्वनि", camera: "कैमरा", chase: "पीछा", helm: "हेल्म", orbit: "परिक्रमा", drone: "ड्रोन",
    sailTrim: "पाल ट्रिम", quality: "गुणवत्ता", low: "कम", medium: "मध्यम", high: "उच्च", reset: "दृश्य रीसेट", photoMode: "फ़ोटो मोड", photoModeHint: "फ़ोटो मोड से बाहर: Esc / दो बार टैप", language: "भाषा", rudder: "पतवार", port: "बायाँ", starboard: "दायाँ", center: "मध्य", centerRudder: "पतवार मध्य करें",
    engine: "इंजन", on: "चालू", off: "बंद", throttle: "थ्रॉटल", forward: "आगे", reverse: "पीछे", fullAhead: "पूरी गति आगे", halfAhead: "आधी गति आगे", slowAhead: "धीरे आगे", fullAstern: "पूरी गति पीछे", halfAstern: "आधी गति पीछे", slowAstern: "धीरे पीछे", neutral: "न्यूट्रल",
    help: "देखने के लिए समुद्र पर स्वाइप करें · ज़ूम के लिए पिंच करें · पतवार और थ्रॉटल अलग चलाएँ",
  },
  es: {
    loadingTitle: "Preparando el mar tropical", loading: "Cargando", rendererNotice: "Aviso del renderizador", sceneInterrupted: "Escena interrumpida", reload: "Recargar simulador",
    speed: "Velocidad", depth: "Profundidad", apparentWind: "Viento aparente", heading: "Rumbo", controls: "Controles", sailingControls: "Controles de navegación", credits: "Créditos 3D", expand: "Abrir panel de control", minimize: "Minimizar panel de control",
    day: "Día", night: "Noche", start: "Arrancar", stop: "Parar", sound: "Sonido", tapSound: "Toca para oír", engineSound: "Sonido del motor", camera: "Cámara", chase: "Seguimiento", helm: "Timón", orbit: "Órbita", drone: "Dron",
    sailTrim: "Ajuste de vela", quality: "Calidad", low: "Baja", medium: "Media", high: "Alta", reset: "Reiniciar escena", photoMode: "Modo foto", photoModeHint: "Salir del modo foto: Esc / doble toque", language: "Idioma", rudder: "Timón", port: "Babor", starboard: "Estribor", center: "Centro", centerRudder: "Centrar timón",
    engine: "Motor", on: "Encendido", off: "Apagado", throttle: "Acelerador", forward: "Avante", reverse: "Atrás", fullAhead: "Toda avante", halfAhead: "Media avante", slowAhead: "Lenta avante", fullAstern: "Toda atrás", halfAstern: "Media atrás", slowAstern: "Lenta atrás", neutral: "Neutro",
    help: "Desliza sobre el mar para mirar · pellizca para ampliar · usa timón y acelerador por separado",
  },
  fr: {
    loadingTitle: "Préparation de la mer tropicale", loading: "Chargement", rendererNotice: "Avis du moteur graphique", sceneInterrupted: "Scène interrompue", reload: "Recharger le simulateur",
    speed: "Vitesse", depth: "Profondeur", apparentWind: "Vent apparent", heading: "Cap", controls: "Commandes", sailingControls: "Commandes de navigation", credits: "Crédits 3D", expand: "Ouvrir le panneau", minimize: "Réduire le panneau",
    day: "Jour", night: "Nuit", start: "Démarrer", stop: "Arrêter", sound: "Son", tapSound: "Touchez pour le son", engineSound: "Son moteur", camera: "Caméra", chase: "Suivi", helm: "Barre", orbit: "Orbite", drone: "Drone",
    sailTrim: "Réglage des voiles", quality: "Qualité", low: "Basse", medium: "Moyenne", high: "Haute", reset: "Réinitialiser la scène", photoMode: "Mode photo", photoModeHint: "Quitter le mode photo : Échap / double appui", language: "Langue", rudder: "Gouvernail", port: "Bâbord", starboard: "Tribord", center: "Centre", centerRudder: "Centrer le gouvernail",
    engine: "Moteur", on: "Marche", off: "Arrêt", throttle: "Manette", forward: "Avant", reverse: "Arrière", fullAhead: "Toute avant", halfAhead: "Demi avant", slowAhead: "Lente avant", fullAstern: "Toute arrière", halfAstern: "Demi arrière", slowAstern: "Lente arrière", neutral: "Neutre",
    help: "Glissez sur la mer pour regarder · pincez pour zoomer · pilotez gouvernail et manette séparément",
  },
  ar: {
    loadingTitle: "جارٍ تجهيز البحر الاستوائي", loading: "جارٍ التحميل", rendererNotice: "تنبيه العرض", sceneInterrupted: "توقف المشهد", reload: "إعادة تحميل المحاكي",
    speed: "السرعة", depth: "العمق", apparentWind: "الرياح الظاهرية", heading: "الاتجاه", controls: "التحكم", sailingControls: "أدوات الإبحار", credits: "اعتمادات 3D", expand: "فتح لوحة التحكم", minimize: "تصغير لوحة التحكم",
    day: "نهار", night: "ليل", start: "تشغيل", stop: "إيقاف", sound: "الصوت", tapSound: "المس لتشغيل الصوت", engineSound: "صوت المحرك", camera: "الكاميرا", chase: "مطاردة", helm: "الدفة", orbit: "مدار", drone: "طائرة",
    sailTrim: "ضبط الشراع", quality: "الجودة", low: "منخفضة", medium: "متوسطة", high: "عالية", reset: "إعادة ضبط المشهد", photoMode: "وضع التصوير", photoModeHint: "الخروج من التصوير: Esc / نقرتان", language: "اللغة", rudder: "الدفة", port: "الميسرة", starboard: "الميمنة", center: "الوسط", centerRudder: "توسيط الدفة",
    engine: "المحرك", on: "تشغيل", off: "إيقاف", throttle: "الخانق", forward: "أمام", reverse: "خلف", fullAhead: "أقصى سرعة أمام", halfAhead: "نصف سرعة أمام", slowAhead: "ببطء أمام", fullAstern: "أقصى سرعة خلف", halfAstern: "نصف سرعة خلف", slowAstern: "ببطء خلف", neutral: "محايد",
    help: "اسحب فوق البحر للنظر · قرّب بإصبعين · استخدم الدفة والخانق بشكل مستقل",
  },
  bn: {
    loadingTitle: "ক্রান্তীয় সমুদ্র প্রস্তুত হচ্ছে", loading: "লোড হচ্ছে", rendererNotice: "রেন্ডারার বার্তা", sceneInterrupted: "দৃশ্য থেমে গেছে", reload: "সিমুলেটর রিলোড করুন",
    speed: "গতি", depth: "গভীরতা", apparentWind: "আপাত বাতাস", heading: "দিক", controls: "নিয়ন্ত্রণ", sailingControls: "নৌযাত্রা নিয়ন্ত্রণ", credits: "3D কৃতিত্ব", expand: "কন্ট্রোল প্যানেল খুলুন", minimize: "কন্ট্রোল প্যানেল ছোট করুন",
    day: "দিন", night: "রাত", start: "চালু", stop: "বন্ধ", sound: "শব্দ", tapSound: "শব্দের জন্য ট্যাপ করুন", engineSound: "ইঞ্জিনের শব্দ", camera: "ক্যামেরা", chase: "অনুসরণ", helm: "হাল", orbit: "কক্ষপথ", drone: "ড্রোন",
    sailTrim: "পাল ট্রিম", quality: "মান", low: "কম", medium: "মাঝারি", high: "উচ্চ", reset: "দৃশ্য রিসেট", photoMode: "ফটো মোড", photoModeHint: "ফটো মোড থেকে বের হন: Esc / দুবার ট্যাপ", language: "ভাষা", rudder: "হাল", port: "বাম", starboard: "ডান", center: "মাঝে", centerRudder: "হাল মাঝখানে",
    engine: "ইঞ্জিন", on: "চালু", off: "বন্ধ", throttle: "থ্রটল", forward: "সামনে", reverse: "পেছনে", fullAhead: "পুরো সামনে", halfAhead: "অর্ধেক সামনে", slowAhead: "ধীরে সামনে", fullAstern: "পুরো পেছনে", halfAstern: "অর্ধেক পেছনে", slowAstern: "ধীরে পেছনে", neutral: "নিরপেক্ষ",
    help: "দেখতে সমুদ্রে সোয়াইপ করুন · জুম করতে পিঞ্চ করুন · হাল ও থ্রটল আলাদাভাবে চালান",
  },
  pt: {
    loadingTitle: "Preparando o mar tropical", loading: "Carregando", rendererNotice: "Aviso do renderizador", sceneInterrupted: "Cena interrompida", reload: "Recarregar simulador",
    speed: "Velocidade", depth: "Profundidade", apparentWind: "Vento aparente", heading: "Rumo", controls: "Controles", sailingControls: "Controles de navegação", credits: "Créditos 3D", expand: "Abrir painel de controle", minimize: "Minimizar painel de controle",
    day: "Dia", night: "Noite", start: "Ligar", stop: "Parar", sound: "Som", tapSound: "Toque para ouvir", engineSound: "Som do motor", camera: "Câmera", chase: "Seguir", helm: "Leme", orbit: "Órbita", drone: "Drone",
    sailTrim: "Ajuste da vela", quality: "Qualidade", low: "Baixa", medium: "Média", high: "Alta", reset: "Reiniciar cena", photoMode: "Modo foto", photoModeHint: "Sair do modo foto: Esc / toque duplo", language: "Idioma", rudder: "Leme", port: "Bombordo", starboard: "Estibordo", center: "Centro", centerRudder: "Centralizar leme",
    engine: "Motor", on: "Ligado", off: "Desligado", throttle: "Acelerador", forward: "Avante", reverse: "Ré", fullAhead: "Toda avante", halfAhead: "Meia avante", slowAhead: "Devagar avante", fullAstern: "Toda ré", halfAstern: "Meia ré", slowAstern: "Devagar ré", neutral: "Neutro",
    help: "Deslize no mar para olhar · belisque para ampliar · use leme e acelerador separadamente",
  },
  ru: {
    loadingTitle: "Подготовка тропического моря", loading: "Загрузка", rendererNotice: "Сообщение рендера", sceneInterrupted: "Сцена прервана", reload: "Перезагрузить симулятор",
    speed: "Скорость", depth: "Глубина", apparentWind: "Вымпельный ветер", heading: "Курс", controls: "Управление", sailingControls: "Управление яхтой", credits: "3D-модели", expand: "Развернуть панель", minimize: "Свернуть панель",
    day: "День", night: "Ночь", start: "Запустить", stop: "Остановить", sound: "Звук", tapSound: "Нажмите для звука", engineSound: "Звук двигателя", camera: "Камера", chase: "Слежение", helm: "Штурвал", orbit: "Орбита", drone: "Дрон",
    sailTrim: "Настройка паруса", quality: "Качество", low: "Низкое", medium: "Среднее", high: "Высокое", reset: "Сброс сцены", photoMode: "Фоторежим", photoModeHint: "Выход из фоторежима: Esc / двойное касание", language: "Язык", rudder: "Руль", port: "Левый борт", starboard: "Правый борт", center: "Центр", centerRudder: "Выровнять руль",
    engine: "Двигатель", on: "Вкл", off: "Выкл", throttle: "Газ", forward: "Вперёд", reverse: "Назад", fullAhead: "Полный вперёд", halfAhead: "Средний вперёд", slowAhead: "Малый вперёд", fullAstern: "Полный назад", halfAstern: "Средний назад", slowAstern: "Малый назад", neutral: "Нейтраль",
    help: "Свайп по морю — обзор · щипок — масштаб · руль и газ работают независимо",
  },
  ur: {
    loadingTitle: "استوائی سمندر تیار ہو رہا ہے", loading: "لوڈ ہو رہا ہے", rendererNotice: "رینڈرر اطلاع", sceneInterrupted: "منظر رک گیا", reload: "سمولیٹر دوبارہ لوڈ کریں",
    speed: "رفتار", depth: "گہرائی", apparentWind: "ظاہری ہوا", heading: "سمت", controls: "کنٹرول", sailingControls: "کشتی کے کنٹرول", credits: "3D کریڈٹس", expand: "کنٹرول پینل کھولیں", minimize: "کنٹرول پینل چھوٹا کریں",
    day: "دن", night: "رات", start: "چلائیں", stop: "روکیں", sound: "آواز", tapSound: "آواز کے لیے ٹیپ کریں", engineSound: "انجن کی آواز", camera: "کیمرہ", chase: "پیچھا", helm: "ہیلم", orbit: "مدار", drone: "ڈرون",
    sailTrim: "بادبان ٹرم", quality: "معیار", low: "کم", medium: "درمیانہ", high: "اعلیٰ", reset: "منظر ری سیٹ", photoMode: "فوٹو موڈ", photoModeHint: "فوٹو موڈ سے نکلیں: Esc / دو بار ٹیپ", language: "زبان", rudder: "پتوار", port: "بایاں", starboard: "دایاں", center: "مرکز", centerRudder: "پتوار مرکز کریں",
    engine: "انجن", on: "چالو", off: "بند", throttle: "تھروٹل", forward: "آگے", reverse: "پیچھے", fullAhead: "پوری رفتار آگے", halfAhead: "آدھی رفتار آگے", slowAhead: "آہستہ آگے", fullAstern: "پوری رفتار پیچھے", halfAstern: "آدھی رفتار پیچھے", slowAstern: "آہستہ پیچھے", neutral: "نیوٹرل",
    help: "دیکھنے کے لیے سمندر پر سوائپ کریں · زوم کے لیے پنچ کریں · پتوار اور تھروٹل الگ چلائیں",
  },
  id: {
    loadingTitle: "Menyiapkan laut tropis", loading: "Memuat", rendererNotice: "Pemberitahuan renderer", sceneInterrupted: "Adegan terhenti", reload: "Muat ulang simulator",
    speed: "Kecepatan", depth: "Kedalaman", apparentWind: "Angin semu", heading: "Haluan", controls: "Kontrol", sailingControls: "Kontrol pelayaran", credits: "Kredit 3D", expand: "Buka panel kontrol", minimize: "Kecilkan panel kontrol",
    day: "Siang", night: "Malam", start: "Nyalakan", stop: "Matikan", sound: "Suara", tapSound: "Ketuk untuk suara", engineSound: "Suara mesin", camera: "Kamera", chase: "Ikuti", helm: "Kemudi", orbit: "Orbit", drone: "Drone",
    sailTrim: "Trim layar", quality: "Kualitas", low: "Rendah", medium: "Sedang", high: "Tinggi", reset: "Atur ulang adegan", photoMode: "Mode foto", photoModeHint: "Keluar mode foto: Esc / ketuk dua kali", language: "Bahasa", rudder: "Kemudi", port: "Kiri", starboard: "Kanan", center: "Tengah", centerRudder: "Tengahkan kemudi",
    engine: "Mesin", on: "Nyala", off: "Mati", throttle: "Gas", forward: "Maju", reverse: "Mundur", fullAhead: "Maju penuh", halfAhead: "Maju setengah", slowAhead: "Maju pelan", fullAstern: "Mundur penuh", halfAstern: "Mundur setengah", slowAstern: "Mundur pelan", neutral: "Netral",
    help: "Geser laut untuk melihat · cubit untuk zoom · gunakan kemudi dan gas secara terpisah",
  },
  de: {
    loadingTitle: "Das tropische Meer wird vorbereitet", loading: "Laden", rendererNotice: "Renderer-Hinweis", sceneInterrupted: "Szene unterbrochen", reload: "Simulator neu laden",
    speed: "Geschwindigkeit", depth: "Tiefe", apparentWind: "Scheinbarer Wind", heading: "Kurs", controls: "Steuerung", sailingControls: "Segelsteuerung", credits: "3D-Credits", expand: "Steuerfeld öffnen", minimize: "Steuerfeld minimieren",
    day: "Tag", night: "Nacht", start: "Start", stop: "Stopp", sound: "Ton", tapSound: "Für Ton tippen", engineSound: "Motorgeräusch", camera: "Kamera", chase: "Verfolgung", helm: "Steuerstand", orbit: "Orbit", drone: "Drohne",
    sailTrim: "Segeltrimm", quality: "Qualität", low: "Niedrig", medium: "Mittel", high: "Hoch", reset: "Szene zurücksetzen", photoMode: "Fotomodus", photoModeHint: "Fotomodus beenden: Esc / Doppeltippen", language: "Sprache", rudder: "Ruder", port: "Backbord", starboard: "Steuerbord", center: "Mitte", centerRudder: "Ruder zentrieren",
    engine: "Motor", on: "Ein", off: "Aus", throttle: "Gashebel", forward: "Voraus", reverse: "Zurück", fullAhead: "Volle Kraft voraus", halfAhead: "Halbe Kraft voraus", slowAhead: "Langsam voraus", fullAstern: "Volle Kraft zurück", halfAstern: "Halbe Kraft zurück", slowAstern: "Langsam zurück", neutral: "Neutral",
    help: "Zum Umschauen über das Meer wischen · zum Zoomen aufziehen · Ruder und Gas getrennt bedienen",
  },
  ja: {
    loadingTitle: "南国の海を準備中", loading: "読み込み中", rendererNotice: "描画のお知らせ", sceneInterrupted: "シーンが中断されました", reload: "シミュレーターを再読み込み",
    speed: "速度", depth: "水深", apparentWind: "見かけの風", heading: "針路", controls: "操作", sailingControls: "セーリング操作", credits: "3Dクレジット", expand: "操作パネルを開く", minimize: "操作パネルを最小化",
    day: "昼", night: "夜", start: "始動", stop: "停止", sound: "サウンド", tapSound: "タップして音を再生", engineSound: "エンジン音", camera: "カメラ", chase: "追従", helm: "操舵席", orbit: "周回", drone: "ドローン",
    sailTrim: "セール調整", quality: "画質", low: "低", medium: "中", high: "高", reset: "シーンをリセット", photoMode: "フォトモード", photoModeHint: "フォトモード終了：Esc / ダブルタップ", language: "言語", rudder: "舵", port: "左舷", starboard: "右舷", center: "中央", centerRudder: "舵を中央へ",
    engine: "エンジン", on: "オン", off: "オフ", throttle: "スロットル", forward: "前進", reverse: "後進", fullAhead: "全速前進", halfAhead: "半速前進", slowAhead: "微速前進", fullAstern: "全速後進", halfAstern: "半速後進", slowAstern: "微速後進", neutral: "ニュートラル",
    help: "海面をスワイプして見回す · ピンチでズーム · 舵とスロットルは個別に操作",
  },
  sw: {
    loadingTitle: "Kuandaa bahari ya kitropiki", loading: "Inapakia", rendererNotice: "Taarifa ya uonyeshaji", sceneInterrupted: "Mandhari imesimama", reload: "Pakia kiigaji upya",
    speed: "Kasi", depth: "Kina", apparentWind: "Upepo dhahiri", heading: "Mwelekeo", controls: "Vidhibiti", sailingControls: "Vidhibiti vya meli", credits: "Shukrani za 3D", expand: "Fungua paneli", minimize: "Punguza paneli",
    day: "Mchana", night: "Usiku", start: "Washa", stop: "Zima", sound: "Sauti", tapSound: "Gusa kwa sauti", engineSound: "Sauti ya injini", camera: "Kamera", chase: "Fuata", helm: "Usukani", orbit: "Mzunguko", drone: "Droni",
    sailTrim: "Mpangilio wa tanga", quality: "Ubora", low: "Chini", medium: "Kati", high: "Juu", reset: "Anza mandhari upya", photoMode: "Hali ya picha", photoModeHint: "Toka hali ya picha: Esc / gusa mara mbili", language: "Lugha", rudder: "Usukani", port: "Kushoto", starboard: "Kulia", center: "Katikati", centerRudder: "Weka usukani kati",
    engine: "Injini", on: "Imewashwa", off: "Imezimwa", throttle: "Kasi", forward: "Mbele", reverse: "Nyuma", fullAhead: "Mbele kabisa", halfAhead: "Nusu mbele", slowAhead: "Polepole mbele", fullAstern: "Nyuma kabisa", halfAstern: "Nusu nyuma", slowAstern: "Polepole nyuma", neutral: "Huru",
    help: "Telezesha baharini kutazama · bana kukuza · tumia usukani na kasi kando",
  },
  mr: {
    loadingTitle: "उष्णकटिबंधीय समुद्र तयार होत आहे", loading: "लोड होत आहे", rendererNotice: "रेंडरर सूचना", sceneInterrupted: "दृश्य थांबले", reload: "सिम्युलेटर पुन्हा लोड करा",
    speed: "वेग", depth: "खोली", apparentWind: "आभासी वारा", heading: "दिशा", controls: "नियंत्रणे", sailingControls: "नौकानयन नियंत्रण", credits: "3D श्रेय", expand: "नियंत्रण पॅनेल उघडा", minimize: "नियंत्रण पॅनेल लहान करा",
    day: "दिवस", night: "रात्र", start: "सुरू", stop: "बंद", sound: "आवाज", tapSound: "आवाजासाठी टॅप करा", engineSound: "इंजिन आवाज", camera: "कॅमेरा", chase: "पाठलाग", helm: "सुकाणू", orbit: "कक्षा", drone: "ड्रोन",
    sailTrim: "शिड समायोजन", quality: "गुणवत्ता", low: "कमी", medium: "मध्यम", high: "उच्च", reset: "दृश्य रीसेट", photoMode: "फोटो मोड", photoModeHint: "फोटो मोडमधून बाहेर: Esc / दोनदा टॅप", language: "भाषा", rudder: "सुकाणू", port: "डावा", starboard: "उजवा", center: "मध्य", centerRudder: "सुकाणू मध्य करा",
    engine: "इंजिन", on: "चालू", off: "बंद", throttle: "थ्रॉटल", forward: "पुढे", reverse: "मागे", fullAhead: "पूर्ण पुढे", halfAhead: "अर्धे पुढे", slowAhead: "हळू पुढे", fullAstern: "पूर्ण मागे", halfAstern: "अर्धे मागे", slowAstern: "हळू मागे", neutral: "न्यूट्रल",
    help: "पाहण्यासाठी समुद्रावर स्वाइप करा · झूमसाठी पिंच करा · सुकाणू व थ्रॉटल स्वतंत्र वापरा",
  },
  te: {
    loadingTitle: "ఉష్ణమండల సముద్రం సిద్ధమవుతోంది", loading: "లోడ్ అవుతోంది", rendererNotice: "రెండరర్ సమాచారం", sceneInterrupted: "దృశ్యం ఆగింది", reload: "సిమ్యులేటర్‌ను మళ్లీ లోడ్ చేయండి",
    speed: "వేగం", depth: "లోతు", apparentWind: "కనిపించే గాలి", heading: "దిశ", controls: "నియంత్రణలు", sailingControls: "నౌక నియంత్రణలు", credits: "3D క్రెడిట్లు", expand: "నియంత్రణ ప్యానెల్ తెరవండి", minimize: "నియంత్రణ ప్యానెల్ చిన్నది చేయండి",
    day: "పగలు", night: "రాత్రి", start: "ప్రారంభం", stop: "ఆపు", sound: "శబ్దం", tapSound: "శబ్దం కోసం నొక్కండి", engineSound: "ఇంజిన్ శబ్దం", camera: "కెమెరా", chase: "వెంట", helm: "హెల్మ్", orbit: "కక్ష్య", drone: "డ్రోన్",
    sailTrim: "తెర సర్దుబాటు", quality: "నాణ్యత", low: "తక్కువ", medium: "మధ్య", high: "అధిక", reset: "దృశ్యాన్ని రీసెట్ చేయి", photoMode: "ఫోటో మోడ్", photoModeHint: "ఫోటో మోడ్ నుండి నిష్క్రమణ: Esc / రెండుసార్లు తట్టండి", language: "భాష", rudder: "చుక్కాని", port: "ఎడమ", starboard: "కుడి", center: "మధ్య", centerRudder: "చుక్కాని మధ్యకు",
    engine: "ఇంజిన్", on: "ఆన్", off: "ఆఫ్", throttle: "థ్రాటిల్", forward: "ముందు", reverse: "వెనుక", fullAhead: "పూర్తి వేగం ముందు", halfAhead: "సగం వేగం ముందు", slowAhead: "నెమ్మదిగా ముందు", fullAstern: "పూర్తి వేగం వెనుక", halfAstern: "సగం వేగం వెనుక", slowAstern: "నెమ్మదిగా వెనుక", neutral: "న్యూట్రల్",
    help: "చూడటానికి సముద్రంపై స్వైప్ చేయండి · జూమ్‌కు పించ్ చేయండి · చుక్కాని, థ్రాటిల్ విడిగా వాడండి",
  },
  tr: {
    loadingTitle: "Tropik deniz hazırlanıyor", loading: "Yükleniyor", rendererNotice: "Görüntüleyici bildirimi", sceneInterrupted: "Sahne kesintiye uğradı", reload: "Simülatörü yeniden yükle",
    speed: "Hız", depth: "Derinlik", apparentWind: "Hissedilen rüzgâr", heading: "Pruva", controls: "Kontroller", sailingControls: "Seyir kontrolleri", credits: "3D katkıları", expand: "Kontrol panelini aç", minimize: "Kontrol panelini küçült",
    day: "Gündüz", night: "Gece", start: "Çalıştır", stop: "Durdur", sound: "Ses", tapSound: "Ses için dokun", engineSound: "Motor sesi", camera: "Kamera", chase: "Takip", helm: "Dümen", orbit: "Yörünge", drone: "Drone",
    sailTrim: "Yelken ayarı", quality: "Kalite", low: "Düşük", medium: "Orta", high: "Yüksek", reset: "Sahneyi sıfırla", photoMode: "Fotoğraf modu", photoModeHint: "Fotoğraf modundan çık: Esc / çift dokun", language: "Dil", rudder: "Dümen", port: "İskele", starboard: "Sancak", center: "Orta", centerRudder: "Dümeni ortala",
    engine: "Motor", on: "Açık", off: "Kapalı", throttle: "Gaz", forward: "İleri", reverse: "Geri", fullAhead: "Tam yol ileri", halfAhead: "Yarım yol ileri", slowAhead: "Yavaş ileri", fullAstern: "Tam yol geri", halfAstern: "Yarım yol geri", slowAstern: "Yavaş geri", neutral: "Boş",
    help: "Bakmak için denizde kaydır · yakınlaştırmak için sıkıştır · dümen ve gazı ayrı kullan",
  },
  ta: {
    loadingTitle: "வெப்பமண்டலக் கடல் தயாராகிறது", loading: "ஏற்றுகிறது", rendererNotice: "காட்சி அறிவிப்பு", sceneInterrupted: "காட்சி தடைப்பட்டது", reload: "சிமுலேட்டரை மீண்டும் ஏற்றவும்",
    speed: "வேகம்", depth: "ஆழம்", apparentWind: "தோற்றக் காற்று", heading: "திசை", controls: "கட்டுப்பாடுகள்", sailingControls: "படகு கட்டுப்பாடுகள்", credits: "3D நன்றிகள்", expand: "கட்டுப்பாட்டுப் பலகையைத் திற", minimize: "கட்டுப்பாட்டுப் பலகையைச் சுருக்கு",
    day: "பகல்", night: "இரவு", start: "தொடங்கு", stop: "நிறுத்து", sound: "ஒலி", tapSound: "ஒலிக்கு தொடவும்", engineSound: "இயந்திர ஒலி", camera: "கேமரா", chase: "பின்தொடர்", helm: "சுக்கான்", orbit: "சுற்று", drone: "ட்ரோன்",
    sailTrim: "பாய் அமைப்பு", quality: "தரம்", low: "குறைவு", medium: "நடுத்தரம்", high: "உயர்", reset: "காட்சியை மீட்டமை", photoMode: "புகைப்பட முறை", photoModeHint: "புகைப்பட முறையிலிருந்து வெளியேற: Esc / இருமுறை தட்டவும்", language: "மொழி", rudder: "சுக்கான்", port: "இடது", starboard: "வலது", center: "நடு", centerRudder: "சுக்கானை நடுவாக்கு",
    engine: "இயந்திரம்", on: "இயக்கம்", off: "நிறுத்தம்", throttle: "வேகக் கட்டுப்பாடு", forward: "முன்", reverse: "பின்", fullAhead: "முழு வேகம் முன்", halfAhead: "பாதி வேகம் முன்", slowAhead: "மெதுவாக முன்", fullAstern: "முழு வேகம் பின்", halfAstern: "பாதி வேகம் பின்", slowAstern: "மெதுவாக பின்", neutral: "நடுநிலை",
    help: "பார்க்க கடலில் ஸ்வைப் செய் · பெரிதாக்க கிள்ளு · சுக்கான் மற்றும் வேகத்தை தனித்தனியாக பயன்படுத்து",
  },
  vi: {
    loadingTitle: "Đang chuẩn bị biển nhiệt đới", loading: "Đang tải", rendererNotice: "Thông báo hiển thị", sceneInterrupted: "Cảnh bị gián đoạn", reload: "Tải lại trình mô phỏng",
    speed: "Tốc độ", depth: "Độ sâu", apparentWind: "Gió biểu kiến", heading: "Hướng", controls: "Điều khiển", sailingControls: "Điều khiển thuyền", credits: "Ghi công 3D", expand: "Mở bảng điều khiển", minimize: "Thu nhỏ bảng điều khiển",
    day: "Ngày", night: "Đêm", start: "Khởi động", stop: "Dừng", sound: "Âm thanh", tapSound: "Chạm để bật âm", engineSound: "Âm động cơ", camera: "Máy quay", chase: "Bám theo", helm: "Buồng lái", orbit: "Quỹ đạo", drone: "Drone",
    sailTrim: "Chỉnh buồm", quality: "Chất lượng", low: "Thấp", medium: "Vừa", high: "Cao", reset: "Đặt lại cảnh", photoMode: "Chế độ ảnh", photoModeHint: "Thoát chế độ ảnh: Esc / chạm hai lần", language: "Ngôn ngữ", rudder: "Bánh lái", port: "Mạn trái", starboard: "Mạn phải", center: "Giữa", centerRudder: "Đưa lái về giữa",
    engine: "Động cơ", on: "Bật", off: "Tắt", throttle: "Ga", forward: "Tiến", reverse: "Lùi", fullAhead: "Hết tốc tiến", halfAhead: "Nửa tốc tiến", slowAhead: "Chậm tiến", fullAstern: "Hết tốc lùi", halfAstern: "Nửa tốc lùi", slowAstern: "Chậm lùi", neutral: "Số không",
    help: "Vuốt trên biển để nhìn · chụm để thu phóng · dùng bánh lái và ga độc lập",
  },
  ko: {
    loadingTitle: "열대 바다 준비 중", loading: "불러오는 중", rendererNotice: "렌더러 알림", sceneInterrupted: "장면이 중단되었습니다", reload: "시뮬레이터 다시 불러오기",
    speed: "속도", depth: "수심", apparentWind: "겉보기 바람", heading: "침로", controls: "조작", sailingControls: "항해 조작", credits: "3D 크레딧", expand: "제어판 열기", minimize: "제어판 최소화",
    day: "낮", night: "밤", start: "시동", stop: "정지", sound: "소리", tapSound: "탭하여 소리 켜기", engineSound: "엔진 소리", camera: "카메라", chase: "추적", helm: "조타석", orbit: "궤도", drone: "드론",
    sailTrim: "돛 조정", quality: "품질", low: "낮음", medium: "중간", high: "높음", reset: "장면 초기화", photoMode: "사진 모드", photoModeHint: "사진 모드 종료: Esc / 두 번 탭", language: "언어", rudder: "방향타", port: "좌현", starboard: "우현", center: "중앙", centerRudder: "방향타 중앙",
    engine: "엔진", on: "켜짐", off: "꺼짐", throttle: "스로틀", forward: "전진", reverse: "후진", fullAhead: "전속 전진", halfAhead: "반속 전진", slowAhead: "저속 전진", fullAstern: "전속 후진", halfAstern: "반속 후진", slowAstern: "저속 후진", neutral: "중립",
    help: "바다를 스와이프해 둘러보기 · 핀치로 확대 · 방향타와 스로틀을 따로 조작",
  },
  it: {
    loadingTitle: "Preparazione del mare tropicale", loading: "Caricamento", rendererNotice: "Avviso del renderer", sceneInterrupted: "Scena interrotta", reload: "Ricarica simulatore",
    speed: "Velocità", depth: "Profondità", apparentWind: "Vento apparente", heading: "Rotta", controls: "Comandi", sailingControls: "Comandi di navigazione", credits: "Crediti 3D", expand: "Apri pannello comandi", minimize: "Riduci pannello comandi",
    day: "Giorno", night: "Notte", start: "Avvia", stop: "Arresta", sound: "Audio", tapSound: "Tocca per l'audio", engineSound: "Audio motore", camera: "Camera", chase: "Inseguimento", helm: "Timone", orbit: "Orbita", drone: "Drone",
    sailTrim: "Regolazione vela", quality: "Qualità", low: "Bassa", medium: "Media", high: "Alta", reset: "Reimposta scena", photoMode: "Modalità foto", photoModeHint: "Esci dalla modalità foto: Esc / doppio tocco", language: "Lingua", rudder: "Timone", port: "Babordo", starboard: "Tribordo", center: "Centro", centerRudder: "Centra timone",
    engine: "Motore", on: "Acceso", off: "Spento", throttle: "Acceleratore", forward: "Avanti", reverse: "Indietro", fullAhead: "Tutta avanti", halfAhead: "Mezza avanti", slowAhead: "Lenta avanti", fullAstern: "Tutta indietro", halfAstern: "Mezza indietro", slowAstern: "Lenta indietro", neutral: "Folle",
    help: "Scorri sul mare per guardare · pizzica per zoomare · usa timone e acceleratore separatamente",
  },
  fa: {
    loadingTitle: "در حال آماده‌سازی دریای گرمسیری", loading: "در حال بارگذاری", rendererNotice: "اعلان نمایش", sceneInterrupted: "صحنه متوقف شد", reload: "بارگذاری دوباره شبیه‌ساز",
    speed: "سرعت", depth: "عمق", apparentWind: "باد ظاهری", heading: "مسیر", controls: "کنترل‌ها", sailingControls: "کنترل‌های قایق", credits: "اعتبارات 3D", expand: "باز کردن پنل کنترل", minimize: "کوچک کردن پنل کنترل",
    day: "روز", night: "شب", start: "روشن", stop: "توقف", sound: "صدا", tapSound: "برای صدا لمس کنید", engineSound: "صدای موتور", camera: "دوربین", chase: "تعقیب", helm: "سکان", orbit: "مدار", drone: "پهپاد",
    sailTrim: "تنظیم بادبان", quality: "کیفیت", low: "کم", medium: "متوسط", high: "زیاد", reset: "بازنشانی صحنه", photoMode: "حالت عکس", photoModeHint: "خروج از حالت عکس: Esc / دو بار ضربه", language: "زبان", rudder: "سکان", port: "چپ", starboard: "راست", center: "مرکز", centerRudder: "سکان به مرکز",
    engine: "موتور", on: "روشن", off: "خاموش", throttle: "گاز", forward: "جلو", reverse: "عقب", fullAhead: "تمام‌سر جلو", halfAhead: "نیم‌سر جلو", slowAhead: "آهسته جلو", fullAstern: "تمام‌سر عقب", halfAstern: "نیم‌سر عقب", slowAstern: "آهسته عقب", neutral: "خلاص",
    help: "برای نگاه روی دریا بکشید · برای بزرگ‌نمایی دو انگشت · سکان و گاز را جدا کنترل کنید",
  },
  pl: {
    loadingTitle: "Przygotowywanie tropikalnego morza", loading: "Ładowanie", rendererNotice: "Komunikat renderera", sceneInterrupted: "Scena przerwana", reload: "Wczytaj symulator ponownie",
    speed: "Prędkość", depth: "Głębokość", apparentWind: "Wiatr pozorny", heading: "Kurs", controls: "Sterowanie", sailingControls: "Sterowanie jachtem", credits: "Autorzy 3D", expand: "Otwórz panel sterowania", minimize: "Zminimalizuj panel sterowania",
    day: "Dzień", night: "Noc", start: "Uruchom", stop: "Zatrzymaj", sound: "Dźwięk", tapSound: "Dotknij, by włączyć dźwięk", engineSound: "Dźwięk silnika", camera: "Kamera", chase: "Pościg", helm: "Ster", orbit: "Orbita", drone: "Dron",
    sailTrim: "Trym żagla", quality: "Jakość", low: "Niska", medium: "Średnia", high: "Wysoka", reset: "Resetuj scenę", photoMode: "Tryb zdjęć", photoModeHint: "Wyjdź z trybu zdjęć: Esc / dwukrotne dotknięcie", language: "Język", rudder: "Ster", port: "Bakburta", starboard: "Sterburta", center: "Środek", centerRudder: "Wycentruj ster",
    engine: "Silnik", on: "Wł.", off: "Wył.", throttle: "Manetka", forward: "Naprzód", reverse: "Wstecz", fullAhead: "Cała naprzód", halfAhead: "Pół naprzód", slowAhead: "Wolno naprzód", fullAstern: "Cała wstecz", halfAstern: "Pół wstecz", slowAstern: "Wolno wstecz", neutral: "Luz",
    help: "Przesuń po morzu, by się rozejrzeć · uszczypnij, by przybliżyć · steruj sterem i manetką osobno",
  },
  uk: {
    loadingTitle: "Підготовка тропічного моря", loading: "Завантаження", rendererNotice: "Повідомлення рендера", sceneInterrupted: "Сцену перервано", reload: "Перезавантажити симулятор",
    speed: "Швидкість", depth: "Глибина", apparentWind: "Вимпельний вітер", heading: "Курс", controls: "Керування", sailingControls: "Керування яхтою", credits: "3D-моделі", expand: "Розгорнути панель", minimize: "Згорнути панель",
    day: "День", night: "Ніч", start: "Запустити", stop: "Зупинити", sound: "Звук", tapSound: "Натисніть для звуку", engineSound: "Звук двигуна", camera: "Камера", chase: "Стеження", helm: "Штурвал", orbit: "Орбіта", drone: "Дрон",
    sailTrim: "Налаштування вітрила", quality: "Якість", low: "Низька", medium: "Середня", high: "Висока", reset: "Скинути сцену", photoMode: "Фоторежим", photoModeHint: "Вихід із фоторежиму: Esc / подвійний дотик", language: "Мова", rudder: "Кермо", port: "Лівий борт", starboard: "Правий борт", center: "Центр", centerRudder: "Вирівняти кермо",
    engine: "Двигун", on: "Увімк.", off: "Вимк.", throttle: "Газ", forward: "Уперед", reverse: "Назад", fullAhead: "Повний уперед", halfAhead: "Середній уперед", slowAhead: "Малий уперед", fullAstern: "Повний назад", halfAstern: "Середній назад", slowAstern: "Малий назад", neutral: "Нейтраль",
    help: "Свайп по морю — огляд · щипок — масштаб · кермо й газ працюють незалежно",
  },
  nl: {
    loadingTitle: "De tropische zee voorbereiden", loading: "Laden", rendererNotice: "Rendererbericht", sceneInterrupted: "Scène onderbroken", reload: "Simulator herladen",
    speed: "Snelheid", depth: "Diepte", apparentWind: "Schijnbare wind", heading: "Koers", controls: "Bediening", sailingControls: "Zeilbediening", credits: "3D-credits", expand: "Bedieningspaneel openen", minimize: "Bedieningspaneel verkleinen",
    day: "Dag", night: "Nacht", start: "Start", stop: "Stop", sound: "Geluid", tapSound: "Tik voor geluid", engineSound: "Motorgeluid", camera: "Camera", chase: "Volgen", helm: "Stuurstand", orbit: "Draaien", drone: "Drone",
    sailTrim: "Zeiltrim", quality: "Kwaliteit", low: "Laag", medium: "Middel", high: "Hoog", reset: "Scène resetten", photoMode: "Fotomodus", photoModeHint: "Fotomodus afsluiten: Esc / dubbeltikken", language: "Taal", rudder: "Roer", port: "Bakboord", starboard: "Stuurboord", center: "Midden", centerRudder: "Roer centreren",
    engine: "Motor", on: "Aan", off: "Uit", throttle: "Gashendel", forward: "Vooruit", reverse: "Achteruit", fullAhead: "Vol vooruit", halfAhead: "Half vooruit", slowAhead: "Langzaam vooruit", fullAstern: "Vol achteruit", halfAstern: "Half achteruit", slowAstern: "Langzaam achteruit", neutral: "Neutraal",
    help: "Veeg over zee om rond te kijken · knijp om te zoomen · bedien roer en gas apart",
  },
  th: {
    loadingTitle: "กำลังเตรียมทะเลเขตร้อน", loading: "กำลังโหลด", rendererNotice: "แจ้งเตือนการแสดงผล", sceneInterrupted: "ฉากหยุดทำงาน", reload: "โหลดโปรแกรมจำลองใหม่",
    speed: "ความเร็ว", depth: "ความลึก", apparentWind: "ลมปรากฏ", heading: "ทิศทาง", controls: "การควบคุม", sailingControls: "การควบคุมเรือ", credits: "เครดิต 3D", expand: "เปิดแผงควบคุม", minimize: "ย่อแผงควบคุม",
    day: "กลางวัน", night: "กลางคืน", start: "สตาร์ต", stop: "หยุด", sound: "เสียง", tapSound: "แตะเพื่อเปิดเสียง", engineSound: "เสียงเครื่องยนต์", camera: "กล้อง", chase: "ติดตาม", helm: "หางเสือ", orbit: "โคจร", drone: "โดรน",
    sailTrim: "ปรับใบเรือ", quality: "คุณภาพ", low: "ต่ำ", medium: "กลาง", high: "สูง", reset: "รีเซ็ตฉาก", photoMode: "โหมดถ่ายภาพ", photoModeHint: "ออกจากโหมดถ่ายภาพ: Esc / แตะสองครั้ง", language: "ภาษา", rudder: "หางเสือ", port: "กราบซ้าย", starboard: "กราบขวา", center: "กลาง", centerRudder: "ตั้งหางเสือตรง",
    engine: "เครื่องยนต์", on: "เปิด", off: "ปิด", throttle: "คันเร่ง", forward: "เดินหน้า", reverse: "ถอยหลัง", fullAhead: "เต็มกำลังหน้า", halfAhead: "ครึ่งกำลังหน้า", slowAhead: "ช้าไปหน้า", fullAstern: "เต็มกำลังถอย", halfAstern: "ครึ่งกำลังถอย", slowAstern: "ช้าถอย", neutral: "เกียร์ว่าง",
    help: "ปัดบนทะเลเพื่อมอง · จีบเพื่อซูม · ใช้หางเสือและคันเร่งแยกกัน",
  },
  gu: {
    loadingTitle: "ઉષ્ણકટિબંધીય સમુદ્ર તૈયાર થઈ રહ્યો છે", loading: "લોડ થઈ રહ્યું છે", rendererNotice: "રેન્ડરર સૂચના", sceneInterrupted: "દૃશ્ય અટક્યું", reload: "સિમ્યુલેટર ફરી લોડ કરો",
    speed: "ઝડપ", depth: "ઊંડાઈ", apparentWind: "દેખીતો પવન", heading: "દિશા", controls: "નિયંત્રણો", sailingControls: "નૌકા નિયંત્રણો", credits: "3D શ્રેય", expand: "નિયંત્રણ પેનલ ખોલો", minimize: "નિયંત્રણ પેનલ નાની કરો",
    day: "દિવસ", night: "રાત", start: "શરૂ", stop: "બંધ", sound: "અવાજ", tapSound: "અવાજ માટે ટેપ કરો", engineSound: "એન્જિન અવાજ", camera: "કેમેરા", chase: "પીછો", helm: "સુકાન", orbit: "ભ્રમણ", drone: "ડ્રોન",
    sailTrim: "સઢ ગોઠવણી", quality: "ગુણવત્તા", low: "ઓછી", medium: "મધ્યમ", high: "ઉચ્ચ", reset: "દૃશ્ય રીસેટ", photoMode: "ફોટો મોડ", photoModeHint: "ફોટો મોડમાંથી બહાર: Esc / બે વાર ટૅપ", language: "ભાષા", rudder: "સુકાન", port: "ડાબું", starboard: "જમણું", center: "મધ્ય", centerRudder: "સુકાન મધ્યમાં",
    engine: "એન્જિન", on: "ચાલુ", off: "બંધ", throttle: "થ્રોટલ", forward: "આગળ", reverse: "પાછળ", fullAhead: "પૂર્ણ આગળ", halfAhead: "અડધું આગળ", slowAhead: "ધીમે આગળ", fullAstern: "પૂર્ણ પાછળ", halfAstern: "અડધું પાછળ", slowAstern: "ધીમે પાછળ", neutral: "ન્યુટ્રલ",
    help: "જોવા માટે સમુદ્ર પર સ્વાઇપ કરો · ઝૂમ માટે પિંચ કરો · સુકાન અને થ્રોટલ અલગ વાપરો",
  },
  fil: {
    loadingTitle: "Inihahanda ang tropikal na dagat", loading: "Naglo-load", rendererNotice: "Abiso sa renderer", sceneInterrupted: "Napatigil ang eksena", reload: "I-reload ang simulator",
    speed: "Bilis", depth: "Lalim", apparentWind: "Tantyang hangin", heading: "Direksiyon", controls: "Mga kontrol", sailingControls: "Kontrol sa paglalayag", credits: "3D credits", expand: "Buksan ang control panel", minimize: "Paliitin ang control panel",
    day: "Araw", night: "Gabi", start: "Paandarin", stop: "Patayin", sound: "Tunog", tapSound: "I-tap para sa tunog", engineSound: "Tunog ng makina", camera: "Camera", chase: "Sundan", helm: "Timon", orbit: "Ikot", drone: "Drone",
    sailTrim: "Ayos ng layag", quality: "Kalidad", low: "Mababa", medium: "Katamtaman", high: "Mataas", reset: "I-reset ang eksena", photoMode: "Photo mode", photoModeHint: "Lumabas sa photo mode: Esc / i-tap nang dalawang beses", language: "Wika", rudder: "Timon", port: "Kaliwa", starboard: "Kanan", center: "Gitna", centerRudder: "Ig gitna ang timon",
    engine: "Makina", on: "Bukas", off: "Patay", throttle: "Silinyador", forward: "Pasulong", reverse: "Paatras", fullAhead: "Todo pasulong", halfAhead: "Kalahating pasulong", slowAhead: "Dahan-dahang pasulong", fullAstern: "Todo paatras", halfAstern: "Kalahating paatras", slowAstern: "Dahan-dahang paatras", neutral: "Neutral",
    help: "Mag-swipe sa dagat para tumingin · mag-pinch para mag-zoom · gamitin nang hiwalay ang timon at silinyador",
  },
  ms: {
    loadingTitle: "Menyediakan laut tropika", loading: "Memuatkan", rendererNotice: "Notis paparan", sceneInterrupted: "Pemandangan terganggu", reload: "Muat semula simulator",
    speed: "Kelajuan", depth: "Kedalaman", apparentWind: "Angin ketara", heading: "Haluan", controls: "Kawalan", sailingControls: "Kawalan pelayaran", credits: "Kredit 3D", expand: "Buka panel kawalan", minimize: "Kecilkan panel kawalan",
    day: "Siang", night: "Malam", start: "Hidupkan", stop: "Matikan", sound: "Bunyi", tapSound: "Ketik untuk bunyi", engineSound: "Bunyi enjin", camera: "Kamera", chase: "Ikut", helm: "Kemudi", orbit: "Orbit", drone: "Dron",
    sailTrim: "Trim layar", quality: "Kualiti", low: "Rendah", medium: "Sederhana", high: "Tinggi", reset: "Tetapkan semula adegan", photoMode: "Mod foto", photoModeHint: "Keluar mod foto: Esc / ketik dua kali", language: "Bahasa", rudder: "Kemudi", port: "Kiri", starboard: "Kanan", center: "Tengah", centerRudder: "Tengahkan kemudi",
    engine: "Enjin", on: "Hidup", off: "Mati", throttle: "Pendikit", forward: "Hadapan", reverse: "Undur", fullAhead: "Penuh hadapan", halfAhead: "Separuh hadapan", slowAhead: "Perlahan hadapan", fullAstern: "Penuh undur", halfAstern: "Separuh undur", slowAstern: "Perlahan undur", neutral: "Neutral",
    help: "Leret laut untuk melihat · cubit untuk zum · guna kemudi dan pendikit berasingan",
  },
  he: {
    loadingTitle: "מכין את הים הטרופי", loading: "טוען", rendererNotice: "הודעת תצוגה", sceneInterrupted: "הסצנה הופסקה", reload: "טעינה מחדש של הסימולטור",
    speed: "מהירות", depth: "עומק", apparentWind: "רוח נראית", heading: "כיוון", controls: "בקרות", sailingControls: "בקרות שיט", credits: "קרדיטים 3D", expand: "פתיחת לוח הבקרה", minimize: "מזעור לוח הבקרה",
    day: "יום", night: "לילה", start: "הפעל", stop: "עצור", sound: "צליל", tapSound: "הקש להפעלת צליל", engineSound: "צליל מנוע", camera: "מצלמה", chase: "מעקב", helm: "הגה", orbit: "מסלול", drone: "רחפן",
    sailTrim: "כיוון מפרש", quality: "איכות", low: "נמוכה", medium: "בינונית", high: "גבוהה", reset: "איפוס הסצנה", photoMode: "מצב צילום", photoModeHint: "יציאה ממצב צילום: Esc / הקשה כפולה", language: "שפה", rudder: "הגה", port: "שמאל", starboard: "ימין", center: "מרכז", centerRudder: "מרכוז ההגה",
    engine: "מנוע", on: "פועל", off: "כבוי", throttle: "מצערת", forward: "קדימה", reverse: "אחורה", fullAhead: "מלא קדימה", halfAhead: "חצי קדימה", slowAhead: "לאט קדימה", fullAstern: "מלא אחורה", halfAstern: "חצי אחורה", slowAstern: "לאט אחורה", neutral: "ניוטרל",
    help: "החליקו על הים כדי להביט · צבטו לזום · השתמשו בהגה ובמצערת בנפרד",
  },
};

/**
 * Messages for the chart, discoveries, signalling and photo mode. Kept in
 * their own table (merged by getMessages) so the core table stays readable.
 */
const ENGLISH_FEATURE_MESSAGES = {
  auto: "Auto",
  map: "Map",
  openMap: "Open map",
  closeMap: "Close map",
  discovered: "Discovered",
  found: "Found",
  places: "Places",
  finds: "Finds",
  unexplored: "Unexplored waters",
  volcano: "Volcano",
  galleon: "Sunken galleon",
  monolith: "Monolith",
  party: "Floating party",
  lighthouse: "Lighthouse",
  bottle: "Message in a bottle",
  crate: "Drifting crate",
  ship: "Ship",
  you: "You",
  bell: "Ring bell",
  flare: "Fire flare",
  flareReloading: "Reloading flare",
  autoTarget: "Auto-target events",
  takePhoto: "Take photo",
  photoSaved: "Photo saved",
  tiltSteering: "Tilt steering",
  swipeHint: "Swipe the wheel to steer",
  rotateHint: "Turn your phone sideways for a wider view",
  dismiss: "Dismiss",
};

type FeatureMessages = { [Key in keyof typeof ENGLISH_FEATURE_MESSAGES]: string };

const FEATURE_TRANSLATIONS: Record<LanguageCode, FeatureMessages> = {
  en: ENGLISH_FEATURE_MESSAGES,
  zh: { auto: "自动", map: "地图", openMap: "打开地图", closeMap: "关闭地图", discovered: "已发现", found: "已找到", places: "地点", finds: "收获", unexplored: "未探索海域", volcano: "火山", galleon: "沉没的大帆船", monolith: "巨石碑", party: "海上派对", lighthouse: "灯塔", bottle: "漂流瓶", crate: "漂流木箱", ship: "船只", you: "你", bell: "敲响船钟", flare: "发射信号弹", flareReloading: "信号弹装填中", autoTarget: "自动追踪精彩事件", takePhoto: "拍照", photoSaved: "照片已保存", tiltSteering: "倾斜转向", swipeHint: "滑动舵轮来转向", rotateHint: "横置手机以获得更宽视野", dismiss: "关闭" },
  hi: { auto: "ऑटो", map: "मानचित्र", openMap: "मानचित्र खोलें", closeMap: "मानचित्र बंद करें", discovered: "खोजा गया", found: "मिला", places: "स्थान", finds: "मिली चीज़ें", unexplored: "अनदेखा समुद्र", volcano: "ज्वालामुखी", galleon: "डूबा हुआ गैलियन", monolith: "मोनोलिथ", party: "तैरती पार्टी", lighthouse: "प्रकाशस्तंभ", bottle: "बोतल में संदेश", crate: "बहता बक्सा", ship: "जहाज़", you: "आप", bell: "घंटी बजाएँ", flare: "फ्लेयर दागें", flareReloading: "फ्लेयर लोड हो रहा है", autoTarget: "घटनाओं पर स्वतः फ़ोकस", takePhoto: "फ़ोटो लें", photoSaved: "फ़ोटो सहेजी गई", tiltSteering: "झुकाकर स्टीयरिंग", swipeHint: "स्टीयर करने के लिए पहिया स्वाइप करें", rotateHint: "चौड़े दृश्य के लिए फ़ोन को आड़ा करें", dismiss: "बंद करें" },
  es: { auto: "Auto", map: "Mapa", openMap: "Abrir mapa", closeMap: "Cerrar mapa", discovered: "Descubierto", found: "Encontrado", places: "Lugares", finds: "Hallazgos", unexplored: "Aguas inexploradas", volcano: "Volcán", galleon: "Galeón hundido", monolith: "Monolito", party: "Fiesta flotante", lighthouse: "Faro", bottle: "Mensaje en una botella", crate: "Caja a la deriva", ship: "Barco", you: "Tú", bell: "Tocar la campana", flare: "Disparar bengala", flareReloading: "Recargando bengala", autoTarget: "Enfocar eventos automáticamente", takePhoto: "Hacer foto", photoSaved: "Foto guardada", tiltSteering: "Dirección por inclinación", swipeHint: "Desliza el timón para virar", rotateHint: "Gira el teléfono en horizontal para ver más", dismiss: "Cerrar" },
  fr: { auto: "Auto", map: "Carte", openMap: "Ouvrir la carte", closeMap: "Fermer la carte", discovered: "Découvert", found: "Trouvé", places: "Lieux", finds: "Trouvailles", unexplored: "Eaux inexplorées", volcano: "Volcan", galleon: "Galion englouti", monolith: "Monolithe", party: "Fête flottante", lighthouse: "Phare", bottle: "Bouteille à la mer", crate: "Caisse à la dérive", ship: "Navire", you: "Vous", bell: "Sonner la cloche", flare: "Tirer une fusée", flareReloading: "Fusée en rechargement", autoTarget: "Cibler les événements automatiquement", takePhoto: "Prendre une photo", photoSaved: "Photo enregistrée", tiltSteering: "Direction par inclinaison", swipeHint: "Glissez sur la barre pour gouverner", rotateHint: "Tournez le téléphone à l’horizontale pour une vue plus large", dismiss: "Fermer" },
  ar: { auto: "تلقائي", map: "خريطة", openMap: "فتح الخريطة", closeMap: "إغلاق الخريطة", discovered: "تم الاكتشاف", found: "تم العثور", places: "أماكن", finds: "مكتشفات", unexplored: "مياه غير مستكشفة", volcano: "بركان", galleon: "سفينة شراعية غارقة", monolith: "مونوليث", party: "حفلة عائمة", lighthouse: "منارة", bottle: "رسالة في زجاجة", crate: "صندوق عائم", ship: "سفينة", you: "أنت", bell: "قرع الجرس", flare: "إطلاق شعلة", flareReloading: "جارٍ تجهيز الشعلة", autoTarget: "تتبع الأحداث تلقائيًا", takePhoto: "التقاط صورة", photoSaved: "تم حفظ الصورة", tiltSteering: "التوجيه بالإمالة", swipeHint: "اسحب الدفة للتوجيه", rotateHint: "أدر الهاتف أفقيًا لرؤية أوسع", dismiss: "إغلاق" },
  bn: { auto: "অটো", map: "মানচিত্র", openMap: "মানচিত্র খুলুন", closeMap: "মানচিত্র বন্ধ করুন", discovered: "আবিষ্কৃত", found: "পাওয়া গেছে", places: "স্থান", finds: "প্রাপ্তি", unexplored: "অনাবিষ্কৃত জলরাশি", volcano: "আগ্নেয়গিরি", galleon: "ডুবে যাওয়া গ্যালিয়ন", monolith: "মনোলিথ", party: "ভাসমান পার্টি", lighthouse: "বাতিঘর", bottle: "বোতলে বার্তা", crate: "ভাসমান বাক্স", ship: "জাহাজ", you: "আপনি", bell: "ঘণ্টা বাজান", flare: "ফ্লেয়ার ছুঁড়ুন", flareReloading: "ফ্লেয়ার লোড হচ্ছে", autoTarget: "ঘটনায় স্বয়ংক্রিয় ফোকাস", takePhoto: "ছবি তুলুন", photoSaved: "ছবি সংরক্ষিত", tiltSteering: "হেলিয়ে স্টিয়ারিং", swipeHint: "চালাতে চাকা সোয়াইপ করুন", rotateHint: "বড় দৃশ্যের জন্য ফোন আড়াআড়ি ঘোরান", dismiss: "বন্ধ করুন" },
  pt: { auto: "Auto", map: "Mapa", openMap: "Abrir mapa", closeMap: "Fechar mapa", discovered: "Descoberto", found: "Encontrado", places: "Locais", finds: "Achados", unexplored: "Águas inexploradas", volcano: "Vulcão", galleon: "Galeão naufragado", monolith: "Monólito", party: "Festa flutuante", lighthouse: "Farol", bottle: "Mensagem na garrafa", crate: "Caixa à deriva", ship: "Navio", you: "Você", bell: "Tocar o sino", flare: "Disparar sinalizador", flareReloading: "Recarregando sinalizador", autoTarget: "Focar eventos automaticamente", takePhoto: "Tirar foto", photoSaved: "Foto salva", tiltSteering: "Direção por inclinação", swipeHint: "Deslize o leme para manobrar", rotateHint: "Gire o celular na horizontal para ver mais", dismiss: "Fechar" },
  ru: { auto: "Авто", map: "Карта", openMap: "Открыть карту", closeMap: "Закрыть карту", discovered: "Открыто", found: "Найдено", places: "Места", finds: "Находки", unexplored: "Неисследованные воды", volcano: "Вулкан", galleon: "Затонувший галеон", monolith: "Монолит", party: "Плавучая вечеринка", lighthouse: "Маяк", bottle: "Послание в бутылке", crate: "Дрейфующий ящик", ship: "Судно", you: "Вы", bell: "Ударить в рынду", flare: "Пустить ракету", flareReloading: "Перезарядка ракетницы", autoTarget: "Автонаведение на события", takePhoto: "Сделать фото", photoSaved: "Фото сохранено", tiltSteering: "Руль наклоном", swipeHint: "Проведите по штурвалу, чтобы рулить", rotateHint: "Поверните телефон горизонтально для широкого обзора", dismiss: "Закрыть" },
  ur: { auto: "خودکار", map: "نقشہ", openMap: "نقشہ کھولیں", closeMap: "نقشہ بند کریں", discovered: "دریافت ہوا", found: "ملا", places: "مقامات", finds: "ملی ہوئی چیزیں", unexplored: "غیر دریافت شدہ پانی", volcano: "آتش فشاں", galleon: "ڈوبا ہوا گیلیئن", monolith: "مونولتھ", party: "تیرتی پارٹی", lighthouse: "لائٹ ہاؤس", bottle: "بوتل میں پیغام", crate: "بہتا صندوق", ship: "جہاز", you: "آپ", bell: "گھنٹی بجائیں", flare: "فلیئر چلائیں", flareReloading: "فلیئر لوڈ ہو رہا ہے", autoTarget: "واقعات پر خودکار فوکس", takePhoto: "تصویر لیں", photoSaved: "تصویر محفوظ ہو گئی", tiltSteering: "جھکا کر اسٹیئرنگ", swipeHint: "چلانے کے لیے پہیہ سوائپ کریں", rotateHint: "وسیع منظر کے لیے فون کو افقی گھمائیں", dismiss: "بند کریں" },
  id: { auto: "Otomatis", map: "Peta", openMap: "Buka peta", closeMap: "Tutup peta", discovered: "Ditemukan", found: "Didapat", places: "Tempat", finds: "Temuan", unexplored: "Perairan belum dijelajahi", volcano: "Gunung berapi", galleon: "Galleon karam", monolith: "Monolit", party: "Pesta terapung", lighthouse: "Mercusuar", bottle: "Pesan dalam botol", crate: "Peti hanyut", ship: "Kapal", you: "Anda", bell: "Bunyikan lonceng", flare: "Tembakkan suar", flareReloading: "Mengisi ulang suar", autoTarget: "Fokus otomatis ke peristiwa", takePhoto: "Ambil foto", photoSaved: "Foto tersimpan", tiltSteering: "Kemudi miring", swipeHint: "Usap kemudi untuk berbelok", rotateHint: "Putar ponsel mendatar untuk tampilan lebih luas", dismiss: "Tutup" },
  de: { auto: "Auto", map: "Karte", openMap: "Karte öffnen", closeMap: "Karte schließen", discovered: "Entdeckt", found: "Gefunden", places: "Orte", finds: "Funde", unexplored: "Unerforschte Gewässer", volcano: "Vulkan", galleon: "Gesunkene Galeone", monolith: "Monolith", party: "Schwimmende Party", lighthouse: "Leuchtturm", bottle: "Flaschenpost", crate: "Treibende Kiste", ship: "Schiff", you: "Du", bell: "Glocke läuten", flare: "Signalrakete abfeuern", flareReloading: "Signalrakete lädt", autoTarget: "Ereignisse automatisch anvisieren", takePhoto: "Foto aufnehmen", photoSaved: "Foto gespeichert", tiltSteering: "Neigungssteuerung", swipeHint: "Zum Steuern über das Steuerrad wischen", rotateHint: "Drehe das Handy quer für mehr Übersicht", dismiss: "Schließen" },
  ja: { auto: "自動", map: "地図", openMap: "地図を開く", closeMap: "地図を閉じる", discovered: "発見", found: "入手", places: "場所", finds: "拾得物", unexplored: "未探索の海域", volcano: "火山", galleon: "沈没ガレオン船", monolith: "モノリス", party: "水上パーティー", lighthouse: "灯台", bottle: "ボトルメール", crate: "漂流する木箱", ship: "船", you: "あなた", bell: "号鐘を鳴らす", flare: "信号弾を発射", flareReloading: "信号弾を装填中", autoTarget: "イベントを自動で追跡", takePhoto: "写真を撮る", photoSaved: "写真を保存しました", tiltSteering: "傾きで操舵", swipeHint: "舵輪をスワイプして操舵", rotateHint: "横向きにすると視界が広がります", dismiss: "閉じる" },
  sw: { auto: "Otomatiki", map: "Ramani", openMap: "Fungua ramani", closeMap: "Funga ramani", discovered: "Imegunduliwa", found: "Imepatikana", places: "Maeneo", finds: "Vilivyopatikana", unexplored: "Maji yasiyochunguzwa", volcano: "Volkano", galleon: "Meli ya kale iliyozama", monolith: "Monolithi", party: "Sherehe inayoelea", lighthouse: "Mnara wa taa", bottle: "Ujumbe ndani ya chupa", crate: "Sanduku linaloelea", ship: "Meli", you: "Wewe", bell: "Gonga kengele", flare: "Fyatua fataki ya ishara", flareReloading: "Inapakia fataki", autoTarget: "Fuatilia matukio kiotomatiki", takePhoto: "Piga picha", photoSaved: "Picha imehifadhiwa", tiltSteering: "Usukani kwa kuinamisha", swipeHint: "Telezesha usukani kugeuza", rotateHint: "Geuza simu ilale kwa mwonekano mpana", dismiss: "Funga" },
  mr: { auto: "ऑटो", map: "नकाशा", openMap: "नकाशा उघडा", closeMap: "नकाशा बंद करा", discovered: "शोधले", found: "सापडले", places: "ठिकाणे", finds: "सापडलेल्या वस्तू", unexplored: "न शोधलेले पाणी", volcano: "ज्वालामुखी", galleon: "बुडालेले गॅलियन", monolith: "मोनोलिथ", party: "तरंगती पार्टी", lighthouse: "दीपगृह", bottle: "बाटलीतील संदेश", crate: "वाहणारी पेटी", ship: "जहाज", you: "तुम्ही", bell: "घंटा वाजवा", flare: "फ्लेअर सोडा", flareReloading: "फ्लेअर भरत आहे", autoTarget: "घटनांवर आपोआप लक्ष", takePhoto: "फोटो घ्या", photoSaved: "फोटो जतन केला", tiltSteering: "झुकवून सुकाणू", swipeHint: "सुकाणूसाठी चाक स्वाइप करा", rotateHint: "विस्तृत दृश्यासाठी फोन आडवा करा", dismiss: "बंद करा" },
  te: { auto: "ఆటో", map: "మ్యాప్", openMap: "మ్యాప్ తెరవండి", closeMap: "మ్యాప్ మూసివేయండి", discovered: "కనుగొనబడింది", found: "దొరికింది", places: "ప్రదేశాలు", finds: "దొరికినవి", unexplored: "అన్వేషించని జలాలు", volcano: "అగ్నిపర్వతం", galleon: "మునిగిన గాలియన్", monolith: "మోనోలిత్", party: "తేలియాడే పార్టీ", lighthouse: "లైట్‌హౌస్", bottle: "సీసాలో సందేశం", crate: "తేలుతున్న పెట్టె", ship: "ఓడ", you: "మీరు", bell: "గంట మోగించండి", flare: "ఫ్లేర్ పేల్చండి", flareReloading: "ఫ్లేర్ రీలోడ్ అవుతోంది", autoTarget: "సంఘటనలపై ఆటో ఫోకస్", takePhoto: "ఫోటో తీయండి", photoSaved: "ఫోటో సేవ్ అయింది", tiltSteering: "వంచి స్టీరింగ్", swipeHint: "తిప్పడానికి చక్రాన్ని స్వైప్ చేయండి", rotateHint: "విశాల దృశ్యానికి ఫోన్‌ను అడ్డంగా తిప్పండి", dismiss: "మూసివేయండి" },
  tr: { auto: "Otomatik", map: "Harita", openMap: "Haritayı aç", closeMap: "Haritayı kapat", discovered: "Keşfedildi", found: "Bulundu", places: "Yerler", finds: "Buluntular", unexplored: "Keşfedilmemiş sular", volcano: "Yanardağ", galleon: "Batık kalyon", monolith: "Monolit", party: "Yüzen parti", lighthouse: "Deniz feneri", bottle: "Şişedeki mesaj", crate: "Sürüklenen sandık", ship: "Gemi", you: "Sen", bell: "Çanı çal", flare: "İşaret fişeği at", flareReloading: "Fişek dolduruluyor", autoTarget: "Olayları otomatik hedefle", takePhoto: "Fotoğraf çek", photoSaved: "Fotoğraf kaydedildi", tiltSteering: "Eğerek dümen", swipeHint: "Dümen için dümen simidini kaydır", rotateHint: "Daha geniş görüş için telefonu yatay çevir", dismiss: "Kapat" },
  ta: { auto: "தானியங்கி", map: "வரைபடம்", openMap: "வரைபடத்தைத் திற", closeMap: "வரைபடத்தை மூடு", discovered: "கண்டுபிடிக்கப்பட்டது", found: "கிடைத்தது", places: "இடங்கள்", finds: "கண்டெடுப்புகள்", unexplored: "ஆராயப்படாத நீர்", volcano: "எரிமலை", galleon: "மூழ்கிய கேலியன்", monolith: "மோனோலித்", party: "மிதக்கும் விருந்து", lighthouse: "கலங்கரை விளக்கம்", bottle: "புட்டியில் செய்தி", crate: "மிதக்கும் பெட்டி", ship: "கப்பல்", you: "நீங்கள்", bell: "மணியை அடி", flare: "ஃப்ளேர் சுடு", flareReloading: "ஃப்ளேர் ஏற்றப்படுகிறது", autoTarget: "நிகழ்வுகளைத் தானாகக் குறிவை", takePhoto: "புகைப்படம் எடு", photoSaved: "புகைப்படம் சேமிக்கப்பட்டது", tiltSteering: "சாய்த்து திசைதிருப்பல்", swipeHint: "திசைதிருப்ப சக்கரத்தை ஸ்வைப் செய்", rotateHint: "அகலமான காட்சிக்கு தொலைபேசியைக் கிடைமட்டமாகத் திருப்பு", dismiss: "மூடு" },
  vi: { auto: "Tự động", map: "Bản đồ", openMap: "Mở bản đồ", closeMap: "Đóng bản đồ", discovered: "Đã khám phá", found: "Đã tìm thấy", places: "Địa điểm", finds: "Vật tìm được", unexplored: "Vùng biển chưa khám phá", volcano: "Núi lửa", galleon: "Thuyền buồm đắm", monolith: "Khối đá nguyên khối", party: "Tiệc nổi", lighthouse: "Hải đăng", bottle: "Thư trong chai", crate: "Thùng trôi dạt", ship: "Tàu", you: "Bạn", bell: "Rung chuông", flare: "Bắn pháo sáng", flareReloading: "Đang nạp pháo sáng", autoTarget: "Tự động bám theo sự kiện", takePhoto: "Chụp ảnh", photoSaved: "Đã lưu ảnh", tiltSteering: "Lái bằng cách nghiêng", swipeHint: "Vuốt bánh lái để điều hướng", rotateHint: "Xoay ngang điện thoại để có tầm nhìn rộng hơn", dismiss: "Đóng" },
  ko: { auto: "자동", map: "지도", openMap: "지도 열기", closeMap: "지도 닫기", discovered: "발견함", found: "획득함", places: "장소", finds: "발견물", unexplored: "미탐험 해역", volcano: "화산", galleon: "침몰한 갤리온", monolith: "모노리스", party: "수상 파티", lighthouse: "등대", bottle: "병 속 편지", crate: "떠다니는 상자", ship: "선박", you: "나", bell: "종 울리기", flare: "조명탄 발사", flareReloading: "조명탄 장전 중", autoTarget: "이벤트 자동 추적", takePhoto: "사진 찍기", photoSaved: "사진 저장됨", tiltSteering: "기울여 조타", swipeHint: "타륜을 밀어 조타하세요", rotateHint: "더 넓게 보려면 휴대폰을 가로로 돌리세요", dismiss: "닫기" },
  it: { auto: "Auto", map: "Mappa", openMap: "Apri mappa", closeMap: "Chiudi mappa", discovered: "Scoperto", found: "Trovato", places: "Luoghi", finds: "Ritrovamenti", unexplored: "Acque inesplorate", volcano: "Vulcano", galleon: "Galeone affondato", monolith: "Monolite", party: "Festa galleggiante", lighthouse: "Faro", bottle: "Messaggio in bottiglia", crate: "Cassa alla deriva", ship: "Nave", you: "Tu", bell: "Suona la campana", flare: "Lancia un razzo", flareReloading: "Razzo in ricarica", autoTarget: "Inquadra eventi automaticamente", takePhoto: "Scatta foto", photoSaved: "Foto salvata", tiltSteering: "Sterzo a inclinazione", swipeHint: "Scorri sul timone per virare", rotateHint: "Ruota il telefono in orizzontale per una vista più ampia", dismiss: "Chiudi" },
  fa: { auto: "خودکار", map: "نقشه", openMap: "باز کردن نقشه", closeMap: "بستن نقشه", discovered: "کشف شد", found: "پیدا شد", places: "مکان‌ها", finds: "یافته‌ها", unexplored: "آب‌های ناشناخته", volcano: "آتشفشان", galleon: "گالیون غرق‌شده", monolith: "مونولیت", party: "مهمانی شناور", lighthouse: "فانوس دریایی", bottle: "پیام در بطری", crate: "صندوق شناور", ship: "کشتی", you: "شما", bell: "نواختن ناقوس", flare: "شلیک منور", flareReloading: "در حال پر کردن منور", autoTarget: "هدف‌گیری خودکار رویدادها", takePhoto: "گرفتن عکس", photoSaved: "عکس ذخیره شد", tiltSteering: "هدایت با کج کردن", swipeHint: "برای هدایت سکان را بکشید", rotateHint: "برای دید وسیع‌تر گوشی را افقی کنید", dismiss: "بستن" },
  pl: { auto: "Auto", map: "Mapa", openMap: "Otwórz mapę", closeMap: "Zamknij mapę", discovered: "Odkryto", found: "Znaleziono", places: "Miejsca", finds: "Znaleziska", unexplored: "Niezbadane wody", volcano: "Wulkan", galleon: "Zatopiony galeon", monolith: "Monolit", party: "Pływająca impreza", lighthouse: "Latarnia morska", bottle: "List w butelce", crate: "Dryfująca skrzynia", ship: "Statek", you: "Ty", bell: "Uderz w dzwon", flare: "Odpal racę", flareReloading: "Ładowanie racy", autoTarget: "Automatyczne śledzenie zdarzeń", takePhoto: "Zrób zdjęcie", photoSaved: "Zdjęcie zapisane", tiltSteering: "Sterowanie przechyłem", swipeHint: "Przesuń koło sterowe, aby sterować", rotateHint: "Obróć telefon poziomo, by widzieć więcej", dismiss: "Zamknij" },
  uk: { auto: "Авто", map: "Карта", openMap: "Відкрити карту", closeMap: "Закрити карту", discovered: "Відкрито", found: "Знайдено", places: "Місця", finds: "Знахідки", unexplored: "Недосліджені води", volcano: "Вулкан", galleon: "Затонулий галеон", monolith: "Моноліт", party: "Плавуча вечірка", lighthouse: "Маяк", bottle: "Лист у пляшці", crate: "Ящик, що дрейфує", ship: "Судно", you: "Ви", bell: "Вдарити в дзвін", flare: "Запустити ракету", flareReloading: "Перезаряджання ракетниці", autoTarget: "Автонаведення на події", takePhoto: "Зробити фото", photoSaved: "Фото збережено", tiltSteering: "Кермування нахилом", swipeHint: "Проведіть по штурвалу, щоб кермувати", rotateHint: "Поверніть телефон горизонтально для ширшого огляду", dismiss: "Закрити" },
  nl: { auto: "Auto", map: "Kaart", openMap: "Kaart openen", closeMap: "Kaart sluiten", discovered: "Ontdekt", found: "Gevonden", places: "Plaatsen", finds: "Vondsten", unexplored: "Onontdekte wateren", volcano: "Vulkaan", galleon: "Gezonken galjoen", monolith: "Monoliet", party: "Drijvend feest", lighthouse: "Vuurtoren", bottle: "Flessenpost", crate: "Drijvende kist", ship: "Schip", you: "Jij", bell: "Bel luiden", flare: "Lichtkogel afvuren", flareReloading: "Lichtkogel laden", autoTarget: "Gebeurtenissen automatisch volgen", takePhoto: "Foto maken", photoSaved: "Foto opgeslagen", tiltSteering: "Sturen door kantelen", swipeHint: "Veeg over het stuurwiel om te sturen", rotateHint: "Draai je telefoon voor een breder beeld", dismiss: "Sluiten" },
  th: { auto: "อัตโนมัติ", map: "แผนที่", openMap: "เปิดแผนที่", closeMap: "ปิดแผนที่", discovered: "ค้นพบแล้ว", found: "พบแล้ว", places: "สถานที่", finds: "สิ่งที่พบ", unexplored: "น่านน้ำที่ยังไม่สำรวจ", volcano: "ภูเขาไฟ", galleon: "เรือกาเลียนที่จม", monolith: "โมโนลิธ", party: "ปาร์ตี้ลอยน้ำ", lighthouse: "ประภาคาร", bottle: "จดหมายในขวด", crate: "ลังลอยน้ำ", ship: "เรือ", you: "คุณ", bell: "ตีระฆัง", flare: "ยิงพลุสัญญาณ", flareReloading: "กำลังบรรจุพลุ", autoTarget: "ติดตามเหตุการณ์อัตโนมัติ", takePhoto: "ถ่ายภาพ", photoSaved: "บันทึกภาพแล้ว", tiltSteering: "บังคับด้วยการเอียง", swipeHint: "ปัดพวงมาลัยเพื่อบังคับ", rotateHint: "หมุนโทรศัพท์แนวนอนเพื่อมุมมองที่กว้างขึ้น", dismiss: "ปิด" },
  gu: { auto: "ઑટો", map: "નકશો", openMap: "નકશો ખોલો", closeMap: "નકશો બંધ કરો", discovered: "શોધાયું", found: "મળ્યું", places: "સ્થળો", finds: "મળેલી વસ્તુઓ", unexplored: "અન્વેષિત ન થયેલું પાણી", volcano: "જ્વાળામુખી", galleon: "ડૂબેલું ગેલિયન", monolith: "મોનોલિથ", party: "તરતી પાર્ટી", lighthouse: "દીવાદાંડી", bottle: "બોટલમાં સંદેશ", crate: "તરતી પેટી", ship: "જહાજ", you: "તમે", bell: "ઘંટ વગાડો", flare: "ફ્લેર છોડો", flareReloading: "ફ્લેર ભરાઈ રહ્યું છે", autoTarget: "ઘટનાઓ પર આપમેળે ફોકસ", takePhoto: "ફોટો લો", photoSaved: "ફોટો સાચવ્યો", tiltSteering: "નમાવીને સુકાન", swipeHint: "સુકાન માટે ચક્ર સ્વાઇપ કરો", rotateHint: "વિશાળ દૃશ્ય માટે ફોન આડો કરો", dismiss: "બંધ કરો" },
  fil: { auto: "Awto", map: "Mapa", openMap: "Buksan ang mapa", closeMap: "Isara ang mapa", discovered: "Natuklasan", found: "Nakita", places: "Mga lugar", finds: "Mga natagpuan", unexplored: "Hindi pa natutuklasang tubig", volcano: "Bulkan", galleon: "Lumubog na galyon", monolith: "Monolith", party: "Lumulutang na party", lighthouse: "Parola", bottle: "Mensahe sa bote", crate: "Lumulutang na kahon", ship: "Barko", you: "Ikaw", bell: "Patunugin ang kampana", flare: "Magpaputok ng flare", flareReloading: "Nagre-reload ng flare", autoTarget: "Awtomatikong sundan ang mga kaganapan", takePhoto: "Kumuha ng litrato", photoSaved: "Nai-save ang litrato", tiltSteering: "Pagmamaneho sa pagkiling", swipeHint: "I-swipe ang manibela para lumiko", rotateHint: "Ihiga ang telepono para sa mas malawak na tanaw", dismiss: "Isara" },
  ms: { auto: "Auto", map: "Peta", openMap: "Buka peta", closeMap: "Tutup peta", discovered: "Ditemui", found: "Dijumpai", places: "Tempat", finds: "Penemuan", unexplored: "Perairan belum diteroka", volcano: "Gunung berapi", galleon: "Galleon karam", monolith: "Monolit", party: "Parti terapung", lighthouse: "Rumah api", bottle: "Utusan dalam botol", crate: "Peti hanyut", ship: "Kapal", you: "Anda", bell: "Bunyikan loceng", flare: "Tembak suar", flareReloading: "Mengisi semula suar", autoTarget: "Fokus automatik pada peristiwa", takePhoto: "Ambil foto", photoSaved: "Foto disimpan", tiltSteering: "Kemudi condong", swipeHint: "Leret roda kemudi untuk membelok", rotateHint: "Pusingkan telefon melintang untuk paparan lebih luas", dismiss: "Tutup" },
  he: { auto: "אוטומטי", map: "מפה", openMap: "פתיחת מפה", closeMap: "סגירת מפה", discovered: "התגלה", found: "נמצא", places: "מקומות", finds: "ממצאים", unexplored: "מים שלא נחקרו", volcano: "הר געש", galleon: "גליון טבוע", monolith: "מונוליט", party: "מסיבה צפה", lighthouse: "מגדלור", bottle: "מכתב בבקבוק", crate: "ארגז נסחף", ship: "ספינה", you: "אתם", bell: "צלצול בפעמון", flare: "ירי זיקוק איתות", flareReloading: "טוען זיקוק", autoTarget: "מעקב אוטומטי אחר אירועים", takePhoto: "צילום תמונה", photoSaved: "התמונה נשמרה", tiltSteering: "היגוי בהטיה", swipeHint: "החליקו על ההגה כדי לנווט", rotateHint: "סובבו את הטלפון לרוחב לתצוגה רחבה יותר", dismiss: "סגירה" },
};

export type Messages = CoreMessages & FeatureMessages;

const LANGUAGE_ALIASES: Record<string, LanguageCode> = {
  tl: "fil",
  iw: "he",
  in: "id",
};

const LANGUAGE_CODES = new Set<string>(LANGUAGE_OPTIONS.map(({ code }) => code));

// Version the preference so the old plain-English startup value cannot pin
// existing users to English forever. A value is written only after a manual
// selection; otherwise the browser language remains authoritative.
export const LANGUAGE_STORAGE_KEY = "sailing-simulator-language-v2";

export function isLanguageCode(value: string): value is LanguageCode {
  return LANGUAGE_CODES.has(value);
}

export function detectLanguage(languages: readonly string[]): LanguageCode {
  for (const candidate of languages) {
    const normalized = candidate.toLowerCase().replaceAll("_", "-");
    const base = normalized.split("-")[0];
    const code = LANGUAGE_ALIASES[normalized] ?? LANGUAGE_ALIASES[base] ?? base;
    if (isLanguageCode(code)) return code;
  }
  return "en";
}

export function resolveLanguagePreference(
  preferredLanguage: string | null | undefined,
  systemLanguages: readonly string[],
): LanguageCode {
  return preferredLanguage && isLanguageCode(preferredLanguage)
    ? preferredLanguage
    : detectLanguage(systemLanguages);
}

const MERGED_MESSAGES = new Map<LanguageCode, Messages>();

export function getMessages(language: LanguageCode): Messages {
  let messages = MERGED_MESSAGES.get(language);
  if (!messages) {
    messages = { ...TRANSLATIONS[language], ...FEATURE_TRANSLATIONS[language] };
    MERGED_MESSAGES.set(language, messages);
  }
  return messages;
}

export function isRtlLanguage(language: LanguageCode): boolean {
  return language === "ar" || language === "fa" || language === "he" || language === "ur";
}
