import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'en' | 'tr';

type TranslationVars = Record<string, string | number>;

const STORAGE_KEY = 'hexgrid-language';

/**
 * English strings are the keys. Turkish values use the same {placeholders}.
 * Keeping the English source as the fallback means a missing translation is
 * never worse than the original UI.
 */
const tr: Record<string, string> = {
  // Shared
  'Cancel': 'İptal',
  'Close': 'Kapat',
  'Save': 'Kaydet',
  'Saving...': 'Kaydediliyor...',
  'Yes': 'Evet',
  'No': 'Hayır',
  'Day': 'Gün',
  'Days': 'Gün',
  'Health': 'Sağlık',
  'Points': 'Puan',
  'pts': 'puan',
  'tokens': 'token',
  'Token': 'Token',
  'Tokens': 'Token',
  'Operative': 'Operatör',
  'Operatives': 'Operatörler',
  'Administrator': 'Yönetici',
  'Game Over': 'Oyun Bitti',
  'Waiting': 'Bekliyor',
  'Live': 'Canlı',
  'Language': 'Dil',
  'Switch Language': 'Dili Değiştir',
  'Preparing round replay...': 'Tur tekrarı hazırlanıyor...',
  'All events completed for this round.': 'Bu turun tüm olayları tamamlandı.',
  'Pause': 'Duraklat',
  'Resume': 'Devam Et',
  'Next Event': 'Sonraki Olay',
  'Next': 'Sonraki',
  'Finish': 'Bitir',
  'Finish Replay': 'Tekrarı Bitir',
  'Skip to Result': 'Sonuca Geç',
  'Auto-playing full match replay...': 'Tam maç tekrarı otomatik oynatılıyor...',
  'ROUND REPLAY: DAY {from} → DAY {to}': 'TUR TEKRARI: GÜN {from} → GÜN {to}',
  'Event {current} of {total}': 'Olay {current} / {total}',

  // Header
  'UNSTARTED': 'BAŞLAMADI',
  'DAY {day}': 'GÜN {day}',
  ' (Live: Day {day})': ' (Canlı: Gün {day})',
  'Turn-based {size}×{size} tactical strategy': 'Sıra tabanlı {size}×{size} taktik strateji',
  'CLOSED (WAITING TO START)': 'KAPALI (BAŞLAMA BEKLİYOR)',
  'GAME OVER ({reason})': 'OYUN BİTTİ ({reason})',
  'CLOSED PHASE (CALCULATING)': 'KAPALI FAZ (HESAPLANIYOR)',
  'OPEN PHASE (ACTIONS OPEN)': 'AÇIK FAZ (AKSİYONLAR AÇIK)',
  'WAITING TO LAUNCH': 'BAŞLATMA BEKLENİYOR',
  'Stage operatives before launching Day 1': '1. Günü başlatmadan önce operatörleri hazırla',
  'UTC Daily Cycle (02:00–24:00 Open | 00:00–02:00 Closed)':
    'UTC Günlük Döngü (02:00–24:00 Açık | 00:00–02:00 Kapalı)',
  'Change Profile': 'Profili Değiştir',
  'DEAD': 'ÖLÜ',
  'Health (Max {max})': 'Sağlık (Maks {max})',
  'Action Points': 'Aksiyon Puanı',
  'Persistent Tokens': 'Kalıcı Token',
  'Staged for deployment · {tokens} tokens': 'Konuşlandırma için hazır · {tokens} token',
  'Toggle World Peace Vote': 'Dünya Barışı Oyunu Aç/Kapat',
  'Peace: YES': 'Barış: EVET',
  'Peace: NO': 'Barış: HAYIR',
  'Admin Console': 'Yönetici Konsolu',
  'Not signed in': 'Giriş yapılmadı',
  'Edit Operative Profile': 'Operatör Profilini Düzenle',
  'Codename / Username': 'Kod Adı / Kullanıcı Adı',
  'Avatar Image URL': 'Avatar Görsel URL',
  'Save Profile': 'Profili Kaydet',
  'Username cannot be empty': 'Kullanıcı adı boş olamaz',
  'Failed to update profile': 'Profil güncellenemedi',
  'Error updating profile': 'Profil güncellenirken hata oluştu',
  'World Peace': 'Dünya Barışı',
  'Last One Standing': 'Son Kalan',
  'world peace': 'dünya barışı',
  'last player standing': 'son kalan oyuncu',
  'waiting to start': 'başlama bekleniyor',
  '{h}h {m}m {s}s': '{h}sa {m}dk {s}sn',
  'CLOSED PHASE ACTIVE': 'KAPALI FAZ AKTİF',
  'The live grid is veiled while backend engines process all planned actions, detonations, and priority queues. The new round opens at 02:00 UTC.':
    "Arka uç motorları planlanan tüm aksiyonları, patlamaları ve öncelik kuyruklarını işlerken canlı ızgara kapalıdır. Yeni tur 02:00 UTC'de açılır.",
  'View Previous Day & My Actions (Day {day})':
    'Önceki Günü ve Aksiyonlarımı Gör (Gün {day})',
  "Unsaved plan changes — your edits haven't been submitted to the server.":
    'Kaydedilmemiş plan değişiklikleri — düzenlemeler sunucuya gönderilmedi.',
  'Saving…': 'Kaydediliyor…',
  'Submit Now': 'Şimdi Gönder',
  'Battlefield Staging — Game Waiting to Start':
    'Savaş Alanı Hazırlığı — Oyun Başlamayı Bekliyor',
  '{count} operative(s) registered. All players will spawn when the game is launched for Day 1.':
    '{count} operatör kayıtlı. Oyun 1. Gün için başlatıldığında tüm oyuncular sahaya çıkar.',
  'Launch Day 1 via the Admin Console (header icon)':
    "1. Günü Yönetici Konsolu'ndan başlat (üst simge)",
  'Awaiting Administrator': 'Yönetici Bekleniyor',
  'Viewing Day {day} archive. Live Day {live} is currently calculating.':
    'Gün {day} arşivi görüntüleniyor. Canlı Gün {live} şu anda hesaplanıyor.',
  'Live Timer': 'Canlı Zamanlayıcı',
  'Viewing Day {day} Archive': 'Gün {day} Arşivi Görüntüleniyor',
  'Actions can only be planned for the live day (Day {day}).':
    'Aksiyonlar yalnızca canlı gün (Gün {day}) için planlanabilir.',
  'Staging Area': 'Hazırlık Alanı',
  'Actions will become available once Day 1 is launched by an administrator.':
    '1. Gün bir yönetici tarafından başlatıldığında aksiyonlar kullanılabilir olacak.',
  'Plan': 'Plan',
  'Players': 'Oyuncular',
  'Failed to submit actions': 'Aksiyonlar gönderilemedi',
  'Submission error': 'Gönderme hatası',
  'Failed to start game': 'Oyun başlatılamadı',
  'Error starting game': 'Oyun başlatılırken hata oluştu',
  'Failed to update building setting': 'Bina ayarı güncellenemedi',
  'Error updating building setting': 'Bina ayarı güncellenirken hata oluştu',
  'Failed to update reward pool': 'Ödül havuzu güncellenemedi',
  'Error updating reward pool': 'Ödül havuzu güncellenirken hata oluştu',
  'Failed to update mine rules': 'Mayın kuralları güncellenemedi',
  'Error updating mine rules': 'Mayın kuralları güncellenirken hata oluştu',
  'Failed to update assassination cost': 'Suikast maliyeti güncellenemedi',
  'Error updating assassination cost': 'Suikast maliyeti güncellenirken hata oluştu',
  'Failed to resolve current day': 'Mevcut gün çözülemedi',
  'Error resolving current day': 'Mevcut gün çözülürken hata oluştu',
  'Failed to end the game': 'Oyun bitirilemedi',
  'Error ending the game': 'Oyun bitirilirken hata oluştu',

  // DaySelector
  'Timeline:': 'Zaman Çizelgesi:',
  'Progress to Next Day (Day {day})': 'Sonraki Güne Geç (Gün {day})',
  'Playing Day Animation...': 'Gün Animasyonu Oynatılıyor...',
  "Closed phase — next day unlocks after 02:00 UTC":
    "Kapalı faz — sonraki gün 02:00 UTC'de açılır",
  'Loading Day {day} state...': 'Gün {day} durumu yükleniyor...',
  'Viewing Live State (Day {day})': 'Canlı Durum (Gün {day})',
  'Day {day}': 'Gün {day}',
  'Full Match Replay': 'Tam Maç Tekrarı',
  'Replay entire match timeline from Day 1 to finish':
    '1. Günden sona kadar tüm maç zaman çizelgesini oynat',

  // PlayerRoster
  'OPERATIVES ({count} Active)': 'OPERATÖRLER ({count} Aktif)',
  'Expand Roster': 'Listeyi Genişlet',
  'Collapse Roster': 'Listeyi Daralt',
  'ELIMINATED': 'ELENDİ',
  'YOU': 'SEN',
  'World Peace Vote': 'Dünya Barışı Oyu',
  'PEACE': 'BARIŞ',
  'WAR': 'SAVAŞ',
  'Games played': 'Oynanan oyun',
  'World Peace wins': 'Dünya Barışı galibiyeti',
  'Last One Standing wins': 'Son Kalan galibiyeti',
  'Deaths': 'Ölümler',
  'Played {count}': 'Oynanan {count}',
  'World Peace {count}': 'Dünya Barışı {count}',
  'Last One {count}': 'Son Kalan {count}',
  'Deaths {count}': 'Ölüm {count}',
  'ROUND RESOLUTION PRIORITY': 'TUR ÇÖZÜM ÖNCELİĞİ',
  'Acts 1st': 'İlk Oynar',
  'Rank #{rank}': 'Sıra #{rank}',
  'Circular 21-Square Tactical Range': 'Dairesel 21 Kare Taktik Menzil',
  '5×5 perimeter excluding 4 corners and self. Tap or hover any operative to see their circular reach.':
    '4 köşe ve kendisi hariç 5×5 çevre. Dairesel menzili görmek için operatöre dokun veya üzerine gel.',

  // Buildings and actions
  'Mine': 'Mayın',
  'Outpost': 'Kamp',
  'Silo': 'Silo',
  'Bank': 'Banka',
  'Nuclear Silo': 'Nükleer Silo',

  // Action planner
  'Transfer': 'Transfer',
  'Heal': 'İyileştir',
  'Build': 'İnşa',
  'Move': 'Hareket',
  'Attack': 'Saldırı',
  'Assassin': 'Suikast',
  'Var': 'Değ.',
  'Fixed': 'Sabit',
  'TRANSFER': 'TRANSFER',
  'HEAL': 'İYİLEŞTİR',
  'BUILD': 'İNŞA',
  'MOVE': 'HAREKET',
  'ATTACK': 'SALDIRI',
  'Allow partial execution': 'Kısmi uygulamaya izin ver',
  'If checked, this action spends whatever points you have left at resolution instead of being cancelled when you cannot afford the full amount.':
    'İşaretlenirse, tam tutarı karşılayamadığında iptal edilmek yerine çözümleme sırasında kalan puanlar harcanır.',
  'Partial execution explanation': 'Kısmi uygulama açıklaması',
  'If checked, this action spends whatever points you have left when it resolves instead of being cancelled because you could not afford the full amount. It never spends more than you have.':
    'İşaretlenirse, tam tutarı karşılayamadığın için iptal edilmek yerine çözümleme sırasında kalan puanlar harcanır. Sahip olduğundan fazlası asla harcanmaz.',
  'Expand Action Deck': 'Aksiyon Destesini Genişlet',
  'Collapse Action Deck': 'Aksiyon Destesini Daralt',
  'ACTION DECK': 'AKSİYON DESTESİ',
  '{count} Queued': '{count} Sırada',
  'Projected Pos: ({x}, {y})': 'Öngörülen Konum: ({x}, {y})',
  'Pts: {points}': 'Puan: {points}',
  'Cost: {cost}': 'Maliyet: {cost}',
  'Left: {left}': 'Kalan: {left}',
  "Your points aren't enough for your currently planned actions — you might want to reconsider, unless someone will send you points this round.":
    'Puanların şu anda planlanan aksiyonlar için yetersiz — biri bu tur sana puan göndermeyecekse planı gözden geçirmek isteyebilirsin.',
  'Closed phase active. Changes locked until 02:00 UTC.':
    "Kapalı faz aktif. Değişiklikler 02:00 UTC'ye kadar kilitli.",
  'Operative eliminated. Actions unavailable.': 'Operatör elendi. Aksiyonlar kullanılamaz.',
  'Movement (1 pt):': 'Hareket (1 puan):',
  'Moves 1 tile. Click an adjacent highlighted tile or use the D-pad. Your ghost updates after every queued move.':
    '1 kare hareket eder. Vurgulanan komşu kareye tıkla veya yön tuşlarını kullan. Hayalet konum her sıradaki hareketten sonra güncellenir.',
  'Move Up': 'Yukarı Git',
  'Move Down': 'Aşağı Git',
  'Move Left': 'Sola Git',
  'Move Right': 'Sağa Git',
  '1 pt': '1 puan',
  'Nuclear Strike:': 'Nükleer Saldırı:',
  'Strike:': 'Saldırı:',
  'Silo at ({x}, {y}) selected. Click any tile to assign its target; it launches next round.':
    '({x}, {y}) konumundaki silo seçildi. Hedef atamak için herhangi bir kareye tıkla; sonraki turda fırlatılır.',
  'Click a ready silo on the map to select its launch target.':
    'Fırlatma hedefini seçmek için haritada hazır bir siloya tıkla.',
  'Click a highlighted tile to strike. 1 pt = 1 damage. Current range is blue; projected range after moves is purple (attacks only).':
    'Saldırmak için vurgulanan bir kareye tıkla. 1 puan = 1 hasar. Mevcut menzil mavi; hamlelerden sonraki öngörülen menzil mor (yalnızca saldırılar).',
  'Target Tile:': 'Hedef Kare:',
  'Click tile on map': 'Haritada kareye tıkla',
  'Fixed launch cost: {cost} pt.': 'Sabit fırlatma maliyeti: {cost} puan.',
  'The selected armed silo is consumed on launch.':
    'Seçilen silahlı silo fırlatmada tüketilir.',
  'Points ({points}):': 'Puan ({points}):',
  'Ready silo{plural}: click a red silo on the map ({positions}), then pick its target tile.':
    'Hazır silo{plural}: haritada kırmızı bir siloya tıkla ({positions}), ardından hedef karesini seç.',
  'Assassinate:': 'Suikast:',
  'This action is disabled for the current game.':
    'Bu aksiyon mevcut oyun için devre dışı.',
  'No range limit. Pick a living opponent to deal {damage} guaranteed damage for {cost} pt.':
    'Menzil sınırı yok. {cost} puan karşılığında {damage} garantili hasar vermek için yaşayan bir rakip seç.',
  'Select Target': 'Hedef Seç',
  'Assassinate': 'Suikast Yap',
  'Fixed cost: {cost} pt. Damage: {damage} HP. Range: unlimited.':
    'Sabit maliyet: {cost} puan. Hasar: {damage} HP. Menzil: sınırsız.',
  'No living opponents available.': 'Kullanılabilir yaşayan rakip yok.',
  'Heal:': 'İyileştir:',
  '1 pt = +1 HP (max {max}). Current HP: {health}/{max}.':
    '1 puan = +1 HP (maks {max}). Mevcut HP: {health}/{max}.',
  'Queue Heal': 'İyileştirme Ekle',
  'Build:': 'İnşa:',
  'Click a highlighted tile in your current range to build. Click your own bank in range to claim it. Queued moves do not extend building range.':
    'İnşa etmek için mevcut menzilindeki vurgulanan bir kareye tıkla. Menzilindeki kendi bankana tıklayarak onu al. Sıradaki hamleler inşa menzilini genişletmez.',
  'Mine (1 pt)': 'Mayın (1 puan)',
  'Outpost (1 pt)': 'Kamp (1 puan)',
  'Nuke Silo (2 pt)': 'Nükleer Silo (2 puan)',
  'Bank (1 pt)': 'Banka (1 puan)',
  '{type} is disabled in this game': '{type} bu oyunda devre dışı',
  'Mine limit reached ({placed}/{limit}). Detonated mines still count.':
    'Mayın sınırına ulaşıldı ({placed}/{limit}). Patlayan mayınlar da sayılır.',
  'Mines: {placed}/{limit} placed': 'Mayınlar: {placed}/{limit} yerleştirildi',
  ' (limit reached)': ' (sınıra ulaşıldı)',
  '+1 on Day {day}': '+1, Gün {day}',
  'No further increases': 'Başka artış yok',
  'Target: {target}': 'Hedef: {target}',
  'Select tile': 'Kare seç',
  'Blue = current · Purple = projected': 'Mavi = mevcut · Mor = öngörülen',
  'Blue = current range': 'Mavi = mevcut menzil',
  'Transfer Points:': 'Puan Transferi:',
  'Click an ally in your current range, or pick a recipient below. Transfers resolve before movement, so only the blue current range counts. 1 pt = 1 transferred point.':
    'Mevcut menzilindeki bir müttefike tıkla veya aşağıdan alıcı seç. Transferler hareketten önce çözülür, bu yüzden yalnızca mavi mevcut menzil sayılır. 1 puan = 1 aktarılan puan.',
  'Select Ally Recipient': 'Müttefik Alıcı Seç',
  'You can plan any amount, even if you do not have enough points yet':
    'Henüz yeterli puanın olmasa bile istediğin tutarı planlayabilirsin',
  'Send': 'Gönder',
  'No living allies in your current range.':
    'Mevcut menzilinde yaşayan müttefik yok.',
  'Blue = current range (transfers happen before movement).':
    'Mavi = mevcut menzil (transferler hareketten önce gerçekleşir).',
  'You can queue a transfer even if you do not have enough points yet (for example, if an ally is sending points this round).':
    'Henüz yeterli puanın olmasa bile transfer ekleyebilirsin (örneğin bir müttefik bu tur puan gönderiyorsa).',
  'Select an action above to plan it. Click the selected action again to deselect.':
    'Planlamak için yukarıdan bir aksiyon seç. Seçimi kaldırmak için seçili aksiyona tekrar tıkla.',
  'Resolution Sequence (Priorities 1→5):': 'Çözüm Sırası (Öncelikler 1→5):',
  'Saved on server': 'Sunucuya kaydedildi',
  'No planned actions yet. Click highlighted map tiles or use the controls above.':
    'Henüz planlanmış aksiyon yok. Vurgulanan harita karelerine tıkla veya yukarıdaki kontrolleri kullan.',
  'from ({x}, {y})': '({x}, {y}) konumundan',
  'Will spend remaining points if the full amount is unaffordable':
    'Tam tutar karşılanamazsa kalan puanlar harcanır',
  'PARTIAL OK': 'KISMİ TAMAM',
  '{cost} pt': '{cost} puan',
  'Resolved by priority group, then round seed.':
    'Öncelik grubuna, ardından tur tohumuna göre çözülür.',
  'Submitting...': 'Gönderiliyor...',
  'Confirm Planned Actions': 'Planlanan Aksiyonları Onayla',
  'assassinate': 'suikast',
  'claim bank': 'banka al',
  'launch nuke': 'nükleer fırlat',
  'up': 'yukarı',
  'down': 'aşağı',
  'left': 'sol',
  'right': 'sağ',
  'mine': 'mayın',
  'outpost': 'kamp',
  'silo': 'silo',
  'bank': 'banka',
  'open': 'açık',
  'closed': 'kapalı',
  'over': 'bitti',

  // Grid map
  'SECTOR GRID': 'SEKTÖR IZGARASI',
  'Target: ({x}, {y})': 'Hedef: ({x}, {y})',
  'Ghost: ({x}, {y})': 'Hayalet: ({x}, {y})',
  'Current': 'Mevcut',
  'Projected': 'Öngörülen',
  'Zoom Out': 'Uzaklaştır',
  'Zoom In': 'Yakınlaştır',
  'Reset Zoom': 'Yakınlaştırmayı Sıfırla',
  'Hide my mines (screenshot mode)': 'Mayınlarımı gizle (ekran modu)',
  'Show my mines': 'Mayınlarımı göster',
  'BANK (HP: {hp}) — Value: {value} (claim next round: {claim})':
    'BANKA (HP: {hp}) — Değer: {value} (sonraki tur al: {claim})',
  '{type} (HP: {hp})': '{type} (HP: {hp})',
  'READY SILO - click to target a nuke': 'HAZIR SILO - nükleer hedeflemek için tıkla',
  'SILO (HP: {hp})': 'SILO (HP: {hp})',
  'BANK': 'BANKA',
  'Value now:': 'Şu anki değer:',
  'Claim next round:': 'Sonraki tur al:',
  'Click with Build to claim': 'Almak için İnşa ile tıkla',
  'Planned Attack': 'Planlanan Saldırı',
  'Planned Attack on enemy operative': 'Düşman operatöre planlanan saldırı',
  'Planned Bank Claim': 'Planlanan Banka Alımı',
  'Planned {type}': 'Planlanan {type}',
  'PLANNED POS': 'PLANLANAN KONUM',
  'EXPLOSION! -1 HP': 'PATLAMA! -1 HP',
  'NUCLEAR BLAST': 'NÜKLEER PATLAMA',

  // Admin panel
  'ADMINISTRATIVE COMMAND CONSOLE': 'YÖNETİM KOMUTA KONSOLU',
  'Game Lifecycle & Operational Triggers': 'Oyun Döngüsü ve Operasyonel Tetikleyiciler',
  'STATUS: CLOSED (UNSTARTED)': 'DURUM: KAPALI (BAŞLAMADI)',
  'STATUS: DAY {day} ({phase})': 'DURUM: GÜN {day} ({phase})',
  'The game is currently unstarted. When all operatives are provisioned, launch Day 1 to spawn all players.':
    'Oyun henüz başlamadı. Tüm operatörler hazırlandığında, tüm oyuncuları sahaya çıkarmak için 1. Günü başlat.',
  'The game is active. Resolve the current day to calculate planned actions and advance to the next day, or reset back to unstarted.':
    'Oyun etkin. Planlanan aksiyonları hesaplamak ve sonraki güne geçmek için mevcut günü çöz veya başlamamış duruma sıfırla.',
  'Map Size': 'Harita Boyutu',
  'Choose the board size for the next game.':
    'Sonraki oyun için tahta boyutunu seç.',
  'Map size is fixed once the game has started.':
    'Oyun başladıktan sonra harita boyutu sabittir.',
  'Player Health': 'Oyuncu Sağlığı',
  'Starting and maximum HP for every operative.':
    'Her operatör için başlangıç ve maksimum HP.',
  'Health is fixed once the game has started.':
    'Oyun başladıktan sonra sağlık sabittir.',
  'Token Reward Pool': 'Token Ödül Havuzu',
  'Tokens split equally among surviving winners. Default: 100.':
    'Tokenlar hayatta kalan kazananlar arasında eşit bölünür. Varsayılan: 100.',
  'Editable mid-game. Split equally among survivors, rounded down.':
    'Oyun sırasında düzenlenebilir. Hayatta kalanlar arasında eşit bölünür, aşağı yuvarlanır.',
  'Mine Limit': 'Mayın Sınırı',
  'Mines each player may place over the whole game. Destroyed mines still count.':
    'Her oyuncunun tüm oyun boyunca yerleştirebileceği mayınlar. Patlayan mayınlar da sayılır.',
  'Editable mid-game. Destroyed mines still count toward the total.':
    'Oyun sırasında düzenlenebilir. Patlayan mayınlar toplama sayılır.',
  'Base mines per player': 'Oyuncu başına temel mayın',
  'mines, +1 every': 'mayın, her',
  'days': 'günde +1',
  'Days between mine limit increases': 'Mayın sınırı artışları arasındaki gün',
  'Assassination Cost': 'Suikast Maliyeti',
  'Points for 1 guaranteed damage with unlimited range. 0 disables it.':
    'Sınırsız menzilde 1 garantili hasar için puan. 0 devre dışı bırakır.',
  'Editable mid-game. 0 disables assassination.':
    'Oyun sırasında düzenlenebilir. 0 suikastı devre dışı bırakır.',
  'Assassination cost in points (0 = disabled)':
    'Puan cinsinden suikast maliyeti (0 = devre dışı)',
  'Buildings': 'Binalar',
  'Disabling a building blocks new construction and interactions with existing ones. Existing buildings stay on the map.':
    'Bir binayı devre dışı bırakmak yeni inşayı ve mevcut binalarla etkileşimi engeller. Mevcut binalar haritada kalır.',
  'Starting...': 'Başlatılıyor...',
  'Launch Game (Spawn 1 Operative)': 'Oyunu Başlat (1 Operatör Yerleştir)',
  'Launch Game (Spawn {count} Operatives)':
    'Oyunu Başlat ({count} Operatör Yerleştir)',
  "Instantly calculates today's planned actions and advances to the next day. The timer stays the same — the new day still ends at its scheduled UTC boundary.":
    'Bugünün planlanan aksiyonlarını anında hesaplar ve sonraki güne geçer. Zamanlayıcı aynı kalır — yeni gün yine planlanan UTC sınırında biter.',
  'Resolving Day...': 'Gün Çözülüyor...',
  'Resolve Current Day': 'Mevcut Günü Çöz',
  'Hold for 5 seconds, then confirm twice. Ends the game and splits tokens equally among surviving winners.':
    '5 saniye basılı tut, sonra iki kez onayla. Oyunu bitirir ve tokenları hayatta kalan kazananlar arasında eşit böler.',
  'Hold... {percent}%': 'Basılı tut... %{percent}',
  'Hold 5s: World Peace': '5 sn bas: Dünya Barışı',
  'Hold for 5 seconds, then confirm twice. Cancels the whole current game and returns to the closed waiting state.':
    '5 saniye basılı tut, sonra iki kez onayla. Tüm mevcut oyunu iptal eder ve kapalı bekleme durumuna döner.',
  'Hold 5s: Reset Game': '5 sn bas: Oyunu Sıfırla',
  'View Logs': 'Günlükleri Gör',
  'Audit & Failure Logs': 'Denetim ve Hata Günlükleri',
  'Close Logs': 'Günlükleri Kapat',
  'End Game In World Peace?': 'Oyun Dünya Barışıyla Bitsin mi?',
  'Cancel The Whole Game?': 'Tüm Oyun İptal Edilsin mi?',
  'This immediately ends the current game. The reward pool of':
    'Bu, mevcut oyunu hemen bitirir. Şu ödül havuzu:',
  '{count} tokens': '{count} token',
  'will be split equally among surviving winners, rounded down, and the game will be marked as finished.':
    'hayatta kalan kazananlar arasında eşit olarak bölünecek, aşağı yuvarlanacak ve oyun bitmiş olarak işaretlenecek.',
  'This button cancels the entire current game and returns the server to the closed waiting state. Player accounts, token balances, and career stats are preserved, but the current match cannot be resumed and must be launched again from Day 1.':
    'Bu düğme mevcut oyunun tamamını iptal eder ve sunucuyu kapalı bekleme durumuna döndürür. Oyuncu hesapları, token bakiyeleri ve kariyer istatistikleri korunur, ancak mevcut maç devam ettirilemez ve 1. Günden yeniden başlatılmalıdır.',
  'This cannot be undone. You must click': 'Bu geri alınamaz. Onaylamak için',
  'YES': 'EVET',
  'twice to confirm.': 'iki kez tıklamalısın.',
  'Yes — Click Again': 'Evet — Tekrar Tıkla',
  'Create New Operative': 'Yeni Operatör Oluştur',
  'Registers a new operative in the database. Generating auth links and profile editing can be done for any existing player below.':
    'Veritabanına yeni bir operatör kaydeder. Yetkilendirme bağlantısı oluşturma ve profil düzenleme aşağıdaki mevcut oyuncular için yapılabilir.',
  'Operative Codename *': 'Operatör Kod Adı *',
  'e.g. Ghost_01': 'örn. Ghost_01',
  'Avatar Image URL (Optional)': 'Avatar Görsel URL (İsteğe Bağlı)',
  'https://... or leave blank for auto': 'https://... veya otomatik için boş bırak',
  'Admin accounts are provisioned by the server. New players never receive administrator rights.':
    'Yönetici hesapları sunucu tarafından sağlanır. Yeni oyuncular asla yönetici hakları almaz.',
  'Creating...': 'Oluşturuluyor...',
  'Create Player': 'Oyuncu Oluştur',
  'Registered Operatives ({count})': 'Kayıtlı Operatörler ({count})',
  'Generate links or edit profiles for any player':
    'Herhangi bir oyuncu için bağlantı oluştur veya profil düzenle',
  'Codename': 'Kod Adı',
  'Avatar URL': 'Avatar URL',
  'ID: {id}... | Played: {played} | World Peace: {peace} | Last One: {last} | Deaths: {deaths} | Tokens: {tokens}':
    'ID: {id}... | Oynanan: {played} | Dünya Barışı: {peace} | Son Kalan: {last} | Ölüm: {deaths} | Token: {tokens}',
  'Admin auth links can only be generated from the server console (npm run admin:link)':
    'Yönetici yetki bağlantıları yalnızca sunucu konsolundan oluşturulabilir (npm run admin:link)',
  'Console only': 'Yalnızca konsol',
  'Generate one-time invite / auth link':
    'Tek kullanımlık davet / yetki bağlantısı oluştur',
  'Generating...': 'Oluşturuluyor...',
  'Auth Link': 'Yetki Bağlantısı',
  'Edit Player Profile': 'Oyuncu Profilini Düzenle',
  'Revoke Player Sessions': 'Oyuncu Oturumlarını İptal Et',
  'Delete Player': 'Oyuncuyu Sil',
  'One-Time Auth / Invite Link for {name}:':
    '{name} için Tek Kullanımlık Yetki / Davet Bağlantısı:',
  'Valid for 7 days': '7 gün geçerli',
  'Copied': 'Kopyalandı',
  'Copy Link': 'Bağlantıyı Kopyala',
  'Revoke all sessions for this player?':
    'Bu oyuncunun tüm oturumları iptal edilsin mi?',
  'All sessions for player revoked.': 'Oyuncunun tüm oturumları iptal edildi.',
  'Delete operative "{name}"? This permanently removes the player.':
    '"{name}" operatörü silinsin mi? Bu, oyuncuyu kalıcı olarak kaldırır.',
  'Are you absolutely sure? "{name}" and all their sessions/invites will be permanently deleted. This cannot be undone.':
    'Kesinlikle emin misin? "{name}" ve tüm oturum/davetleri kalıcı olarak silinecek. Bu geri alınamaz.',
  'Failed to create player': 'Oyuncu oluşturulamadı',
  'Error creating player': 'Oyuncu oluşturulurken hata oluştu',
  'Failed to generate auth link': 'Yetki bağlantısı oluşturulamadı',
  'Error generating auth link': 'Yetki bağlantısı oluşturulurken hata oluştu',
  'Failed to update player': 'Oyuncu güncellenemedi',
  'Failed to delete player': 'Oyuncu silinemedi',
  'Player "{name}" created successfully.':
    '"{name}" oyuncusu başarıyla oluşturuldu.',

  // Replay event types
  'send points': 'puan gönder',
  'heal': 'iyileştir',
  'build': 'inşa et',
  'move': 'hareket',
  'attack': 'saldırı',
  'damage': 'hasar',
  'death': 'ölüm',
  'building destroyed': 'bina yıkıldı',
  'mine triggered': 'mayın tetiklendi',
  'nuke launch': 'nükleer fırlatma',
  'bank claimed': 'banka alındı',
  'cancelled': 'iptal',
};

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (text: string, vars?: TranslationVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'tr') return stored;
  } catch {
    // localStorage can be unavailable in private/embedded contexts.
  }
  return window.navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(detectLanguage);

  const setLanguage = useCallback((next: Language) => setLanguageState(next), []);
  const toggleLanguage = useCallback(
    () => setLanguageState((prev) => (prev === 'en' ? 'tr' : 'en')),
    []
  );

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Persistence is best-effort.
    }
  }, [language]);

  const t = useCallback(
    (text: string, vars?: TranslationVars) => {
      const template = language === 'tr' ? tr[text] ?? text : text;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, key: string) =>
        vars[key] !== undefined ? String(vars[key]) : match
      );
    },
    [language]
  );

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
