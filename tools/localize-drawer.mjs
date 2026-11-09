import {writeFile} from "node:fs/promises"
import {runInNewContext} from "node:vm"
import {adapters} from "../sims/adapters.js"

// Use PhET's own captions where the drawer exposes the same concept.
const commonKeys = {
  Simulation: "preferences.tabs.simulation.title",
  Preferences: "preferences.title",
  Audio: "preferences.tabs.audio.title",
  Projector: "projectorMode",
  "Region and culture": "preferences.tabs.localization.regionAndCulture.title",
  "United States": "preferences.tabs.localization.regionAndCulture.unitedStatesOfAmerica",
  Africa: "preferences.tabs.localization.regionAndCulture.africa",
  "Africa (modest dress)": "preferences.tabs.localization.regionAndCulture.africaModest",
  Asia: "preferences.tabs.localization.regionAndCulture.asia",
  "Latin America": "preferences.tabs.localization.regionAndCulture.latinAmerica",
  Oceania: "preferences.tabs.localization.regionAndCulture.oceania",
  Random: "preferences.tabs.localization.regionAndCulture.random",
}

const labels = [
  "Screens", "Enabled screens", "Color profile", "Default", "Enabled", "Disabled", "Muted", "Shown", "Hidden",
  "Choose the screens learners can open. Clearing the selection enables all screens.",
]
const shared = {
  ar: ["الشاشات", "الشاشات المفعّلة", "ملف الألوان", "افتراضي", "مفعّل", "معطّل", "صامت", "ظاهر", "مخفي", "اختر الشاشات التي يمكن للمتعلمين فتحها. يؤدي مسح التحديد إلى تفعيل جميع الشاشات."],
  bg: ["Екрани", "Разрешени екрани", "Цветови профил", "По подразбиране", "Включено", "Изключено", "Заглушено", "Показано", "Скрито", "Изберете екраните, които учащите могат да отворят. Изчистването на избора разрешава всички екрани."],
  ca: ["Pantalles", "Pantalles habilitades", "Perfil de color", "Per defecte", "Habilitat", "Deshabilitat", "Silenciat", "Visible", "Ocult", "Tria les pantalles que poden obrir els alumnes. Si buides la selecció, s’habiliten totes les pantalles."],
  cs: ["Obrazovky", "Povolené obrazovky", "Barevný profil", "Výchozí", "Zapnuto", "Vypnuto", "Ztlumeno", "Zobrazeno", "Skryto", "Vyberte obrazovky, které mohou žáci otevřít. Zrušením výběru povolíte všechny obrazovky."],
  da: ["Skærme", "Aktiverede skærme", "Farveprofil", "Standard", "Til", "Fra", "Lydløs", "Vises", "Skjult", "Vælg, hvilke skærme eleverne kan åbne. Ryd valget for at aktivere alle skærme."],
  de: ["Bildschirme", "Aktivierte Bildschirme", "Farbprofil", "Standard", "Aktiviert", "Deaktiviert", "Stumm", "Sichtbar", "Ausgeblendet", "Wähle, welche Bildschirme Lernende öffnen können. Ohne Auswahl sind alle Bildschirme verfügbar."],
  el: ["Οθόνες", "Ενεργές οθόνες", "Χρωματικό προφίλ", "Προεπιλογή", "Ενεργό", "Ανενεργό", "Σίγαση", "Ορατό", "Κρυφό", "Επιλέξτε τις οθόνες που μπορούν να ανοίξουν οι μαθητές. Αν καταργήσετε την επιλογή, ενεργοποιούνται όλες οι οθόνες."],
  es: ["Pantallas", "Pantallas habilitadas", "Perfil de color", "Predeterminado", "Activado", "Desactivado", "Silenciado", "Visible", "Oculto", "Elige las pantallas que pueden abrir los estudiantes. Si borras la selección, se habilitan todas las pantallas."],
  fi: ["Näytöt", "Käytössä olevat näytöt", "Väriprofiili", "Oletus", "Käytössä", "Poissa käytöstä", "Mykistetty", "Näkyvissä", "Piilotettu", "Valitse näytöt, jotka oppijat voivat avata. Valinnan tyhjentäminen ottaa kaikki näytöt käyttöön."],
  fr: ["Écrans", "Écrans activés", "Profil de couleur", "Par défaut", "Activé", "Désactivé", "Muet", "Visible", "Masqué", "Choisissez les écrans que les élèves peuvent ouvrir. Effacez la sélection pour activer tous les écrans."],
  he: ["מסכים", "מסכים פעילים", "פרופיל צבע", "ברירת מחדל", "מופעל", "מושבת", "מושתק", "גלוי", "מוסתר", "בחרו את המסכים שהלומדים יכולים לפתוח. ניקוי הבחירה מפעיל את כל המסכים."],
  hi: ["स्क्रीन", "सक्षम स्क्रीन", "रंग प्रोफ़ाइल", "डिफ़ॉल्ट", "सक्षम", "अक्षम", "म्यूट", "दृश्यमान", "छिपा हुआ", "चुनें कि विद्यार्थी कौन-सी स्क्रीन खोल सकते हैं। चयन हटाने पर सभी स्क्रीन सक्षम हो जाती हैं।"],
  hu: ["Képernyők", "Engedélyezett képernyők", "Színprofil", "Alapértelmezett", "Engedélyezve", "Letiltva", "Némítva", "Látható", "Rejtett", "Válaszd ki, mely képernyőket nyithatják meg a tanulók. A kijelölés törlése minden képernyőt engedélyez."],
  id: ["Layar", "Layar yang diaktifkan", "Profil warna", "Bawaan", "Aktif", "Nonaktif", "Senyap", "Ditampilkan", "Disembunyikan", "Pilih layar yang dapat dibuka pelajar. Kosongkan pilihan untuk mengaktifkan semua layar."],
  it: ["Schermate", "Schermate abilitate", "Profilo colore", "Predefinito", "Attivo", "Disattivo", "Silenziato", "Visibile", "Nascosto", "Scegli le schermate che gli studenti possono aprire. Cancella la selezione per abilitare tutte le schermate."],
  ja: ["画面", "有効な画面", "カラープロファイル", "既定", "有効", "無効", "ミュート", "表示", "非表示", "学習者が開ける画面を選びます。選択を解除すると、すべての画面が有効になります。"],
  ko: ["화면", "활성화된 화면", "색상 프로필", "기본값", "활성화", "비활성화", "음소거", "표시", "숨김", "학습자가 열 수 있는 화면을 선택하세요. 선택을 지우면 모든 화면이 활성화됩니다."],
  nb: ["Skjermer", "Aktiverte skjermer", "Fargeprofil", "Standard", "På", "Av", "Dempet", "Vises", "Skjult", "Velg hvilke skjermer elevene kan åpne. Fjern valget for å aktivere alle skjermer."],
  nl: ["Schermen", "Ingeschakelde schermen", "Kleurprofiel", "Standaard", "Ingeschakeld", "Uitgeschakeld", "Gedempt", "Zichtbaar", "Verborgen", "Kies welke schermen leerlingen kunnen openen. Wis de selectie om alle schermen in te schakelen."],
  pl: ["Ekrany", "Włączone ekrany", "Profil kolorów", "Domyślny", "Włączone", "Wyłączone", "Wyciszone", "Widoczne", "Ukryte", "Wybierz ekrany, które uczniowie mogą otwierać. Wyczyszczenie wyboru włącza wszystkie ekrany."],
  pt: ["Ecrãs", "Ecrãs ativados", "Perfil de cor", "Predefinido", "Ativado", "Desativado", "Sem som", "Visível", "Oculto", "Escolhe os ecrãs que os alunos podem abrir. Limpa a seleção para ativar todos os ecrãs."],
  "pt-BR": ["Telas", "Telas ativadas", "Perfil de cor", "Padrão", "Ativado", "Desativado", "Silenciado", "Visível", "Oculto", "Escolha as telas que os alunos podem abrir. Limpe a seleção para ativar todas as telas."],
  ro: ["Ecrane", "Ecrane activate", "Profil de culoare", "Implicit", "Activat", "Dezactivat", "Fără sunet", "Vizibil", "Ascuns", "Alege ecranele pe care le pot deschide cursanții. Dacă golești selecția, toate ecranele vor fi activate."],
  ru: ["Экраны", "Доступные экраны", "Цветовой профиль", "По умолчанию", "Включено", "Выключено", "Без звука", "Показано", "Скрыто", "Выберите экраны, которые учащиеся могут открыть. Если снять выделение, будут доступны все экраны."],
  sk: ["Obrazovky", "Povolené obrazovky", "Farebný profil", "Predvolené", "Zapnuté", "Vypnuté", "Stlmené", "Zobrazené", "Skryté", "Vyberte obrazovky, ktoré môžu žiaci otvoriť. Zrušením výberu povolíte všetky obrazovky."],
  sl: ["Zasloni", "Omogočeni zasloni", "Barvni profil", "Privzeto", "Omogočeno", "Onemogočeno", "Utišano", "Vidno", "Skrito", "Izberi zaslone, ki jih lahko učenci odprejo. Če počistiš izbor, omogočiš vse zaslone."],
  sv: ["Skärmar", "Aktiverade skärmar", "Färgprofil", "Standard", "Aktiverad", "Inaktiverad", "Ljud av", "Visas", "Dold", "Välj vilka skärmar eleverna kan öppna. Rensa valet för att aktivera alla skärmar."],
  th: ["หน้าจอ", "หน้าจอที่เปิดใช้", "โปรไฟล์สี", "ค่าเริ่มต้น", "เปิดใช้", "ปิดใช้", "ปิดเสียง", "แสดง", "ซ่อน", "เลือกหน้าจอที่ผู้เรียนเปิดได้ ล้างการเลือกเพื่อเปิดใช้ทุกหน้าจอ"],
  tr: ["Ekranlar", "Etkin ekranlar", "Renk profili", "Varsayılan", "Etkin", "Devre dışı", "Sessiz", "Görünür", "Gizli", "Öğrencilerin açabileceği ekranları seçin. Tüm ekranları etkinleştirmek için seçimi temizleyin."],
  uk: ["Екрани", "Доступні екрани", "Колірний профіль", "Типовий", "Увімкнено", "Вимкнено", "Без звуку", "Показано", "Приховано", "Виберіть екрани, які можуть відкривати учні. Якщо очистити вибір, будуть доступні всі екрани."],
  vi: ["Màn hình", "Màn hình được bật", "Cấu hình màu", "Mặc định", "Đã bật", "Đã tắt", "Tắt tiếng", "Hiển thị", "Ẩn", "Chọn màn hình mà người học có thể mở. Xóa lựa chọn để bật tất cả màn hình."],
  "zh-Hans": ["屏幕", "已启用的屏幕", "色彩配置", "默认", "已启用", "已禁用", "静音", "显示", "隐藏", "选择学习者可以打开的屏幕。清除选择即可启用所有屏幕。"],
  "zh-Hant": ["畫面", "已啟用的畫面", "色彩設定", "預設", "已啟用", "已停用", "靜音", "顯示", "隱藏", "選擇學習者可以開啟的畫面。清除選擇即可啟用所有畫面。"],
}

const german = {
  "Show solvent molecules": "Lösungsmittelmoleküle anzeigen",
  "Game timer": "Spielzeit messen",
  Liters: "Liter", "Cubic decimeters": "Kubikdezimeter",
  "Function variable": "Funktionsvariable", "Derivative notation": "Schreibweise der Ableitung",
  "Connect discontinuities": "Sprungstellen verbinden", "No line": "Keine Linie", "Dashed line": "Gestrichelte Linie",
  "Show values": "Werte anzeigen", "Prediction tool": "Vorhersagewerkzeug",
  "Original function checkbox": "Kontrollkästchen für die ursprüngliche Funktion",
  "Maximum kicks": "Maximale Anzahl an Schüssen", "Show outliers": "Ausreißer anzeigen",
  "Show patterns": "Muster anzeigen", "Acceleration units": "Einheiten der Beschleunigung",
  "Magnetic field units": "Einheiten des Magnetfelds", "Earth checkbox": "Kontrollkästchen für die Erde",
  Western: "Westlich", Eastern: "Östlich", "Puller colors": "Farben der ziehenden Figuren",
  Direct: "Direkt", Indirect: "Indirekt", "2F points checkbox": "Kontrollkästchen für die 2F-Punkte",
  "Cueing arrows": "Hinweispfeile", "Animate lipids": "Lipide animieren",
  "Positive to negative": "Positiv nach negativ", "Negative to positive": "Negativ nach positiv",
  "Surface colors": "Oberflächenfarben", "Blue, white and red": "Blau, Weiß und Rot", Rainbow: "Regenbogen",
  "Ones on the Lab screen": "Einer auf dem Laborbildschirm",
  "Read numbers aloud automatically": "Zahlen automatisch vorlesen",
  "Enable a second spoken language": "Zweite Ausgabesprache aktivieren", "Second spoken language": "Zweite Ausgabesprache",
  "Use primary spoken language": "Erste Ausgabesprache verwenden", "Number model": "Zahlenmodell",
  "Put the sum on top": "Summe oben anzeigen", "Show ones on the Lab screen": "Einer auf dem Laborbildschirm anzeigen",
  "Time to show each quantity": "Anzeigedauer pro Menge", "Auto-fill solutions": "Lösungen automatisch einfüllen",
  "Generate data automatically": "Daten automatisch erzeugen", "Landing sound": "Landegeräusch",
  "Sound design": "Klanggestaltung", Layered: "Überlagert", "Unique per shape": "Für jede Form verschieden",
  "Keep sound tracks playing": "Tonspuren weiter abspielen",
  "Phase checkbox": "Kontrollkästchen für die Phase",
  "Hide classical coins at the start": "Klassische Münzen beim Start ausblenden",
  Signed: "Mit Vorzeichen", Unsigned: "Ohne Vorzeichen",
}

const aliases = {ef: "efi", fa_DA: "fa-AF", pr: "tsz", sp: "nso", ua: "nah"}
const canonical = tag => Intl.getCanonicalLocales(aliases[tag] ?? tag.replaceAll("_", "-"))[0]
const strip = value => value.replace(/[\u202a-\u202e\u2066-\u2069]/g, "").trim()
const normalize = value => strip(value).toLowerCase().replace(/[\p{P}\p{Z}]/gu, "")

function readStrings(html) {
  const expression = html.match(/^window\.phet\.chipper\.strings = ([^\r\n]+);$/m)?.[1]
  if (!expression) throw new Error("PhET's bundled string table is missing.")
  // This is the packed string table generated by the pinned local PhET build.
  return runInNewContext(expression, {}, {timeout: 1000})
}

function copyTranslations(target, tables, key, english) {
  if (!key) return
  for (const [code, strings] of Object.entries(tables)) {
    if (code === "en") continue
    const text = strings[key] && strip(strings[key])
    if (text && text !== english && !/[<{]/.test(text)) target[canonical(code)] ??= text
  }
}

const common = Object.fromEntries([...Object.keys(commonKeys), ...labels].map(label => [label, {}]))
for (const [tag, translations] of Object.entries(shared)) {
  if (translations.length !== labels.length) throw new Error(`Incomplete drawer labels for ${tag}`)
  for (const [index, label] of labels.entries()) common[label][tag] = translations[index]
}

const simulations = {}
for (const [id, adapter] of adapters) {
  const {default: simulation} = await adapter.load()
  const strings = readStrings(typeof simulation === "function" ? simulation() : simulation)
  for (const [label, key] of Object.entries(commonKeys)) copyTranslations(common[label], strings, "JOIST/" + key, label)
  if (!adapter.preferences) continue
  const namespace = id.toUpperCase().replaceAll("-", "_") + "/"
  const matches = Object.entries(strings.en).filter(([key]) => key.startsWith(namespace) || !key.includes("/a11y."))
  const labels = new Set(Object.values(adapter.preferences).flatMap(option => [
    option.label, ...(option.options ?? []).map(choice => choice.label),
  ]))
  const translated = {}
  for (const label of labels) {
    if (common[label] || !/[a-z]{2}/i.test(label)) continue
    const keys = matches.filter(([, value]) => normalize(value) === normalize(label)).map(([key]) => key)
    const key = keys.find(key => key.startsWith(namespace) && /preferences/i.test(key)) ??
      keys.find(key => key.startsWith(namespace)) ?? keys[0]
    const translations = {}
    copyTranslations(translations, strings, key, label)
    if (german[label]) translations.de ??= german[label]
    if (Object.keys(translations).length) translated[label] = translations
  }
  if (Object.keys(translated).length) simulations[id] = translated
}
await writeFile(new URL("../localization/drawer.json", import.meta.url),
  JSON.stringify({common, simulations}, null, 2) + "\n")
