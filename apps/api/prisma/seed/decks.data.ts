/**
 * Public starter deck catalogue — COMPREHENSIVE EDITION.
 *
 * Each card tuple: [front, back, ipa?, example?]
 * - `front` is the prompt the learner sees first.
 * - `back` is the target translation / expansion (Vietnamese for most decks).
 * - `ipa` is optional pronunciation aid (IPA, romaji, pinyin, romanisation).
 * - `example` is an optional sentence using the term in context.
 *
 * Levels follow CEFR for Latin-script languages and the official proficiency
 * frameworks for Asian ones (JLPT N5–N1, HSK 1–6, TOPIK 1–6).
 *
 * Total: 40+ decks, 700+ cards across English, Japanese, Chinese, Korean, Vietnamese.
 */
export interface SeedCard {
  /** Set to the old front text when changing a previously published prompt. */
  key?: string;
  front: string;
  back: string;
  ipa?: string;
  example?: string;
}

export interface SeedDeck {
  /** Stable slug-ish title used as idempotency key when seeding. */
  title: string;
  description: string;
  language: string;
  level: string;
  cards: SeedCard[];
}

const card = (front: string, back: string, ipa?: string, example?: string): SeedCard => ({
  front,
  back,
  ipa,
  example,
});

// ═══════════════════════════════════════════════════════════════════════════════
// ██ ENGLISH DECKS (14 decks)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. English — Basic Greetings (A1) — 20 cards ─────────────────────────────

const englishGreetings: SeedDeck = {
  title: 'English — Basic Greetings',
  description: 'Everyday hellos, goodbyes and polite phrases for level A1 learners.',
  language: 'english',
  level: 'A1',
  cards: [
    card('Hello', 'Xin chào', 'həˈloʊ', 'Hello, how are you?'),
    card('Good morning', 'Chào buổi sáng', 'ɡʊd ˈmɔːr.nɪŋ', 'Good morning, everyone!'),
    card('Good afternoon', 'Chào buổi chiều', 'ɡʊd ˌæf.tərˈnuːn', 'Good afternoon, Mr. Smith.'),
    card('Good evening', 'Chào buổi tối', 'ɡʊd ˈiːv.nɪŋ', 'Good evening, ladies and gentlemen.'),
    card('Good night', 'Chúc ngủ ngon', 'ɡʊd naɪt', 'Good night, sleep well.'),
    card('Goodbye', 'Tạm biệt', 'ɡʊdˈbaɪ', 'Goodbye, see you tomorrow.'),
    card('See you later', 'Hẹn gặp lại', 'siː juː ˈleɪ.tər', 'See you later, alligator!'),
    card('Please', 'Làm ơn / Xin', 'pliːz', 'Please sit down.'),
    card('Thank you', 'Cảm ơn', 'θæŋk juː', 'Thank you very much.'),
    card('Thanks a lot', 'Cảm ơn rất nhiều', 'θæŋks ə lɒt', 'Thanks a lot for your help.'),
    card("You're welcome", 'Không có gì', 'jʊr ˈwel.kəm', "You're welcome, anytime!"),
    card('Excuse me', 'Xin lỗi (làm phiền)', 'ɪkˈskjuːz miː', 'Excuse me, where is the bathroom?'),
    card("I'm sorry", 'Tôi xin lỗi', 'aɪm ˈsɒr.i', "I'm sorry for being late."),
    card('How are you?', 'Bạn khỏe không?', 'haʊ ɑːr juː', 'Hi John, how are you?'),
    card("I'm fine, thanks", 'Tôi khỏe, cảm ơn', 'aɪm faɪn θæŋks', "I'm fine, thanks. And you?"),
    card('Nice to meet you', 'Rất vui được gặp bạn', 'naɪs tə miːt juː', 'Nice to meet you, Sarah.'),
    card("What's your name?", 'Tên bạn là gì?', 'wɒts jɔːr neɪm', "What's your name? My name is Tom."),
    card('My name is...', 'Tên tôi là...', 'maɪ neɪm ɪz', 'My name is Linh.'),
    card('How do you do?', 'Rất hân hạnh (trang trọng)', 'haʊ duː juː duː', 'How do you do? Pleased to meet you.'),
    card('Take care', 'Bảo trọng', 'teɪk keər', 'Take care, see you next week!'),
  ],
};

// ─── 2. English — Numbers 1 to 20 (A1) — 20 cards ─────────────────────────────

const englishNumbers: SeedDeck = {
  title: 'English — Numbers 1 to 20',
  description: 'Cardinal numbers from one to twenty with pronunciation and example uses.',
  language: 'english',
  level: 'A1',
  cards: [
    card('One', 'Một', 'wʌn', 'I have one apple.'),
    card('Two', 'Hai', 'tuː', 'Two cups of coffee, please.'),
    card('Three', 'Ba', 'θriː', 'There are three cats.'),
    card('Four', 'Bốn', 'fɔːr', 'The table has four legs.'),
    card('Five', 'Năm', 'faɪv', 'Give me five minutes.'),
    card('Six', 'Sáu', 'sɪks', 'He has six pencils.'),
    card('Seven', 'Bảy', 'ˈsev.ən', 'There are seven days in a week.'),
    card('Eight', 'Tám', 'eɪt', 'I wake up at eight o\'clock.'),
    card('Nine', 'Chín', 'naɪn', 'She scored nine out of ten.'),
    card('Ten', 'Mười', 'ten', 'Count to ten.'),
    card('Eleven', 'Mười một', 'ɪˈlev.ən', 'The game starts at eleven.'),
    card('Twelve', 'Mười hai', 'twelv', 'There are twelve months in a year.'),
    card('Thirteen', 'Mười ba', 'ˌθɜːrˈtiːn', 'She is thirteen years old.'),
    card('Fourteen', 'Mười bốn', 'ˌfɔːrˈtiːn', 'February fourteenth is Valentine\'s Day.'),
    card('Fifteen', 'Mười lăm', 'ˌfɪfˈtiːn', 'The bus arrives in fifteen minutes.'),
    card('Sixteen', 'Mười sáu', 'ˌsɪksˈtiːn', 'She turned sixteen yesterday.'),
    card('Seventeen', 'Mười bảy', 'ˌsev.ənˈtiːn', 'There are seventeen students in the class.'),
    card('Eighteen', 'Mười tám', 'ˌeɪˈtiːn', 'You must be eighteen to drive.'),
    card('Nineteen', 'Mười chín', 'ˌnaɪnˈtiːn', 'The nineteenth century was full of change.'),
    card('Twenty', 'Hai mươi', 'ˈtwen.ti', 'There are twenty students in our class.'),
  ],
};

// ─── 3. English — Travel Essentials (A2) — 20 cards ───────────────────────────

const englishTravel: SeedDeck = {
  title: 'English — Travel Essentials',
  description: 'Words you will hear in airports, hotels and on public transport.',
  language: 'english',
  level: 'A2',
  cards: [
    card('Passport', 'Hộ chiếu', 'ˈpæs.pɔːrt', 'Show me your passport, please.'),
    card('Boarding pass', 'Thẻ lên máy bay', 'ˈbɔːr.dɪŋ pæs', 'Here is my boarding pass.'),
    card('Luggage', 'Hành lý', 'ˈlʌɡ.ɪdʒ', 'My luggage is very heavy.'),
    card('Carry-on', 'Hành lý xách tay', 'ˈkær.i ɒn', 'You can bring one carry-on bag.'),
    card('Departure', 'Khởi hành', 'dɪˈpɑːr.tʃər', 'The departure time is 9 AM.'),
    card('Arrival', 'Đến nơi', 'əˈraɪ.vəl', 'Estimated arrival is 3 PM.'),
    card('Gate', 'Cửa lên máy bay', 'ɡeɪt', 'The gate number is B12.'),
    card('Customs', 'Hải quan', 'ˈkʌs.təmz', 'We need to pass through customs.'),
    card('Hotel reception', 'Lễ tân khách sạn', 'hoʊˈtel rɪˈsep.ʃən', 'Please check in at hotel reception.'),
    card('Reservation', 'Đặt phòng / đặt chỗ', 'ˌrez.ərˈveɪ.ʃən', 'I have a reservation under Nguyen.'),
    card('Single room', 'Phòng đơn', 'ˈsɪŋ.ɡəl ruːm', 'I\'d like a single room for two nights.'),
    card('Double room', 'Phòng đôi', 'ˈdʌb.əl ruːm', 'A double room costs more.'),
    card('Check-in', 'Nhận phòng / làm thủ tục', 'tʃek ɪn', 'Check-in time is at 2 PM.'),
    card('Check-out', 'Trả phòng', 'tʃek aʊt', 'Check-out is by noon.'),
    card('Receipt', 'Hoá đơn', 'rɪˈsiːt', 'Can I have a receipt, please?'),
    card('Currency exchange', 'Đổi tiền', 'ˈkɜːr.ən.si ɪksˈtʃeɪndʒ', 'Where is the currency exchange?'),
    card('Map', 'Bản đồ', 'mæp', 'Do you have a city map?'),
    card('Train station', 'Ga tàu', 'treɪn ˈsteɪ.ʃən', 'The train station is near the hotel.'),
    card('Taxi stand', 'Bến taxi', 'ˈtæk.si stænd', 'The taxi stand is outside.'),
    card('Flight delay', 'Chuyến bay bị trễ', 'flaɪt dɪˈleɪ', 'There is a two-hour flight delay.'),
  ],
};

// ─── 4. English — Business Essentials (B1) — 20 cards ─────────────────────────

const englishBusiness: SeedDeck = {
  title: 'English — Business Essentials',
  description: 'Vocabulary for meetings, deadlines and email etiquette.',
  language: 'english',
  level: 'B1',
  cards: [
    card('Agenda', 'Lịch trình / chương trình họp', 'əˈdʒen.də', 'Let\'s review the agenda for today\'s meeting.'),
    card('Deadline', 'Hạn chót', 'ˈded.laɪn', 'The deadline is Friday at 5 PM.'),
    card('Stakeholder', 'Bên liên quan', 'ˈsteɪkˌhoʊl.dər', 'All stakeholders must approve the plan.'),
    card('Revenue', 'Doanh thu', 'ˈrev.ə.nuː', 'Revenue increased by 15% this quarter.'),
    card('Profit', 'Lợi nhuận', 'ˈprɒf.ɪt', 'The company made a profit of $1 million.'),
    card('Loss', 'Khoản lỗ / thua lỗ', 'lɒs', 'We recorded a net loss this year.'),
    card('Forecast', 'Dự báo', 'ˈfɔːr.kæst', 'The sales forecast looks promising.'),
    card('Quarterly report', 'Báo cáo quý', 'ˈkwɔːr.tər.li rɪˈpɔːrt', 'The quarterly report is due next week.'),
    card('Negotiation', 'Đàm phán', 'nɪˌɡoʊ.ʃiˈeɪ.ʃən', 'We are in the final stage of negotiation.'),
    card('Proposal', 'Đề xuất', 'prəˈpoʊ.zəl', 'Please submit your proposal by Monday.'),
    card('Invoice', 'Hoá đơn (xuất bán)', 'ˈɪn.vɔɪs', 'I\'ll send the invoice today.'),
    card('Workflow', 'Quy trình làm việc', 'ˈwɜːrk.floʊ', 'We need to improve our workflow.'),
    card('Onboarding', 'Đào tạo nhân viên mới', 'ˈɒnˌbɔːr.dɪŋ', 'The onboarding process takes two weeks.'),
    card('Synergy', 'Hiệp lực / cộng hưởng', 'ˈsɪn.ər.dʒi', 'This merger will create synergy.'),
    card('Leverage', 'Tận dụng / đòn bẩy', 'ˈlev.ər.ɪdʒ', 'We can leverage our brand reputation.'),
    card('Budget', 'Ngân sách', 'ˈbʌdʒ.ɪt', 'The project is within budget.'),
    card('Milestone', 'Cột mốc', 'ˈmaɪl.stoʊn', 'We reached an important milestone.'),
    card('KPI', 'Chỉ số hiệu suất', 'keɪ piː aɪ', 'Our main KPI is customer satisfaction.'),
    card('Outsource', 'Thuê ngoài', 'ˈaʊt.sɔːrs', 'We outsource our IT support.'),
    card('Benchmark', 'Tiêu chuẩn so sánh', 'ˈbentʃ.mɑːrk', 'We benchmark against industry leaders.'),
  ],
};

// ─── 5. English — Food & Cooking (A1) — 20 cards ──────────────────────────────

const englishFood: SeedDeck = {
  title: 'English — Food & Cooking',
  description: 'Everyday food items, cooking verbs, and kitchen vocabulary for beginners.',
  language: 'english',
  level: 'A1',
  cards: [
    card('Rice', 'Gạo / Cơm', 'raɪs', 'I eat rice every day.'),
    card('Bread', 'Bánh mì', 'bred', 'She bought fresh bread this morning.'),
    card('Chicken', 'Thịt gà', 'ˈtʃɪk.ɪn', 'I like fried chicken.'),
    card('Beef', 'Thịt bò', 'biːf', 'Beef pho is a Vietnamese specialty.'),
    card('Pork', 'Thịt heo / thịt lợn', 'pɔːrk', 'Pork chops are on the menu.'),
    card('Fish', 'Cá', 'fɪʃ', 'I had grilled fish for dinner.'),
    card('Egg', 'Trứng', 'eɡ', 'Do you want a fried egg?'),
    card('Vegetable', 'Rau', 'ˈvedʒ.tə.bəl', 'Eat more vegetables!'),
    card('Fruit', 'Trái cây / hoa quả', 'fruːt', 'Fruit is good for your health.'),
    card('Milk', 'Sữa', 'mɪlk', 'I drink milk every morning.'),
    card('Sugar', 'Đường', 'ˈʃʊɡ.ər', 'How much sugar do you want?'),
    card('Salt', 'Muối', 'sɔːlt', 'Add a pinch of salt.'),
    card('Pepper', 'Tiêu / ớt', 'ˈpep.ər', 'Pass me the pepper, please.'),
    card('Oil', 'Dầu ăn', 'ɔɪl', 'Heat the oil in a pan.'),
    card('Cook', 'Nấu ăn', 'kʊk', 'My mother cooks dinner every night.'),
    card('Boil', 'Đun sôi / luộc', 'bɔɪl', 'Boil the water before adding noodles.'),
    card('Fry', 'Chiên / rán', 'fraɪ', 'Fry the onions until golden.'),
    card('Bake', 'Nướng (lò)', 'beɪk', 'I bake cookies every weekend.'),
    card('Knife', 'Con dao', 'naɪf', 'Use a sharp knife to cut the meat.'),
    card('Plate', 'Đĩa', 'pleɪt', 'Put the food on a clean plate.'),
  ],
};

// ─── 6. English — Body Parts & Health (A2) — 20 cards ─────────────────────────

const englishHealth: SeedDeck = {
  title: 'English — Body Parts & Health',
  description: 'Essential body part names and health-related vocabulary.',
  language: 'english',
  level: 'A2',
  cards: [
    card('Head', 'Đầu', 'hed', 'I have a headache.'),
    card('Eye', 'Mắt', 'aɪ', 'She has beautiful blue eyes.'),
    card('Ear', 'Tai', 'ɪr', 'My left ear hurts.'),
    card('Nose', 'Mũi', 'noʊz', 'He has a runny nose.'),
    card('Mouth', 'Miệng', 'maʊθ', 'Open your mouth, please.'),
    card('Tooth', 'Răng', 'tuːθ', 'I need to see the dentist about my tooth.'),
    card('Hand', 'Bàn tay', 'hænd', 'Wash your hands before eating.'),
    card('Arm', 'Cánh tay', 'ɑːrm', 'He broke his arm playing football.'),
    card('Leg', 'Chân (đùi + ống)', 'leɡ', 'My legs are tired after running.'),
    card('Foot', 'Bàn chân', 'fʊt', 'I stepped on a stone with my bare foot.'),
    card('Stomach', 'Dạ dày / bụng', 'ˈstʌm.ək', 'I have a stomachache.'),
    card('Back', 'Lưng', 'bæk', 'My back hurts from sitting too long.'),
    card('Heart', 'Tim', 'hɑːrt', 'Exercise is good for your heart.'),
    card('Fever', 'Sốt', 'ˈfiː.vər', 'She has a high fever.'),
    card('Cough', 'Ho', 'kɒf', 'I\'ve had a cough for three days.'),
    card('Medicine', 'Thuốc', 'ˈmed.ɪ.sən', 'Take this medicine after meals.'),
    card('Doctor', 'Bác sĩ', 'ˈdɒk.tər', 'You should see a doctor.'),
    card('Hospital', 'Bệnh viện', 'ˈhɒs.pɪ.təl', 'The hospital is on Main Street.'),
    card('Pharmacy', 'Nhà thuốc', 'ˈfɑːr.mə.si', 'The pharmacy closes at 9 PM.'),
    card('Allergy', 'Dị ứng', 'ˈæl.ər.dʒi', 'I have an allergy to peanuts.'),
  ],
};

// ─── 7. English — Weather & Seasons (A1) — 15 cards ──────────────────────────

const englishWeather: SeedDeck = {
  title: 'English — Weather & Seasons',
  description: 'Talking about weather conditions and the four seasons.',
  language: 'english',
  level: 'A1',
  cards: [
    card('Sunny', 'Nắng', 'ˈsʌn.i', 'It\'s sunny today.'),
    card('Cloudy', 'Nhiều mây', 'ˈklaʊ.di', 'It\'s cloudy but warm.'),
    card('Rainy', 'Mưa', 'ˈreɪ.ni', 'It\'s going to be rainy tomorrow.'),
    card('Windy', 'Có gió', 'ˈwɪn.di', 'It\'s very windy outside.'),
    card('Snowy', 'Có tuyết', 'ˈsnoʊ.i', 'The mountains are snowy in winter.'),
    card('Hot', 'Nóng', 'hɒt', 'Summer is very hot in Vietnam.'),
    card('Cold', 'Lạnh', 'koʊld', 'It\'s cold, wear a jacket.'),
    card('Warm', 'Ấm', 'wɔːrm', 'Spring weather is warm and pleasant.'),
    card('Cool', 'Mát mẻ', 'kuːl', 'The evenings are cool and breezy.'),
    card('Storm', 'Bão', 'stɔːrm', 'A big storm is coming tonight.'),
    card('Temperature', 'Nhiệt độ', 'ˈtem.prə.tʃər', 'The temperature is 35 degrees.'),
    card('Spring', 'Mùa xuân', 'sprɪŋ', 'Flowers bloom in spring.'),
    card('Summer', 'Mùa hè', 'ˈsʌm.ər', 'I love swimming in summer.'),
    card('Autumn', 'Mùa thu', 'ˈɔː.təm', 'Leaves change color in autumn.'),
    card('Winter', 'Mùa đông', 'ˈwɪn.tər', 'It snows a lot in winter.'),
  ],
};

// ─── 8. English — Colors & Shapes (A1) — 15 cards ─────────────────────────────

const englishColors: SeedDeck = {
  title: 'English — Colors & Shapes',
  description: 'Basic colors and common shapes for visual learners.',
  language: 'english',
  level: 'A1',
  cards: [
    card('Red', 'Đỏ', 'red', 'The apple is red.'),
    card('Blue', 'Xanh dương', 'bluː', 'The sky is blue today.'),
    card('Green', 'Xanh lá', 'ɡriːn', 'Grass is green.'),
    card('Yellow', 'Vàng', 'ˈjel.oʊ', 'Bananas are yellow.'),
    card('Orange', 'Cam', 'ˈɒr.ɪndʒ', 'She wore an orange dress.'),
    card('Purple', 'Tím', 'ˈpɜːr.pəl', 'Purple is my favorite color.'),
    card('Black', 'Đen', 'blæk', 'He wears a black hat.'),
    card('White', 'Trắng', 'waɪt', 'Snow is white.'),
    card('Brown', 'Nâu', 'braʊn', 'The dog is brown.'),
    card('Pink', 'Hồng', 'pɪŋk', 'She likes pink flowers.'),
    card('Circle', 'Hình tròn', 'ˈsɜːr.kəl', 'Draw a circle on the paper.'),
    card('Square', 'Hình vuông', 'skwer', 'The box is square.'),
    card('Triangle', 'Hình tam giác', 'ˈtraɪ.æŋ.ɡəl', 'A triangle has three sides.'),
    card('Rectangle', 'Hình chữ nhật', 'ˈrek.tæŋ.ɡəl', 'The screen is a rectangle.'),
    card('Star', 'Hình ngôi sao', 'stɑːr', 'Draw a five-pointed star.'),
  ],
};

// ─── 9. English — Emotions & Feelings (A2) — 20 cards ─────────────────────────

const englishEmotions: SeedDeck = {
  title: 'English — Emotions & Feelings',
  description: 'Express your emotions with this essential vocabulary set.',
  language: 'english',
  level: 'A2',
  cards: [
    card('Happy', 'Vui vẻ / hạnh phúc', 'ˈhæp.i', 'I feel happy today.'),
    card('Sad', 'Buồn', 'sæd', 'She looks sad. What happened?'),
    card('Angry', 'Tức giận', 'ˈæŋ.ɡri', 'Don\'t be angry with me.'),
    card('Scared', 'Sợ hãi', 'skerd', 'The children were scared of the dark.'),
    card('Surprised', 'Ngạc nhiên', 'sərˈpraɪzd', 'I was surprised by the gift.'),
    card('Tired', 'Mệt mỏi', 'taɪərd', 'I\'m tired after work.'),
    card('Excited', 'Hào hứng / phấn khích', 'ɪkˈsaɪ.tɪd', 'We are excited about the trip!'),
    card('Bored', 'Chán', 'bɔːrd', 'I\'m bored. Let\'s do something fun.'),
    card('Nervous', 'Lo lắng / hồi hộp', 'ˈnɜːr.vəs', 'He was nervous before the exam.'),
    card('Confident', 'Tự tin', 'ˈkɒn.fɪ.dənt', 'She felt confident about the interview.'),
    card('Lonely', 'Cô đơn', 'ˈloʊn.li', 'Living abroad can be lonely.'),
    card('Grateful', 'Biết ơn', 'ˈɡreɪt.fəl', 'I am grateful for your support.'),
    card('Jealous', 'Ghen tị', 'ˈdʒel.əs', 'Don\'t be jealous of others.'),
    card('Proud', 'Tự hào', 'praʊd', 'I am proud of my daughter.'),
    card('Embarrassed', 'Xấu hổ / ngượng', 'ɪmˈbær.əst', 'He was embarrassed by the mistake.'),
    card('Calm', 'Bình tĩnh', 'kɑːm', 'Stay calm and take a deep breath.'),
    card('Anxious', 'Lo âu', 'ˈæŋk.ʃəs', 'She felt anxious about the results.'),
    card('Disappointed', 'Thất vọng', 'ˌdɪs.əˈpɔɪn.tɪd', 'I was disappointed with the service.'),
    card('Hopeful', 'Đầy hy vọng', 'ˈhoʊp.fəl', 'We are hopeful about the future.'),
    card('Confused', 'Bối rối / lúng túng', 'kənˈfjuːzd', 'I\'m confused by these instructions.'),
  ],
};

// ─── 10. English — Technology & Internet (B1) — 20 cards ──────────────────────

const englishTech: SeedDeck = {
  title: 'English — Technology & Internet',
  description: 'Modern tech vocabulary covering devices, software and the web.',
  language: 'english',
  level: 'B1',
  cards: [
    card('Software', 'Phần mềm', 'ˈsɒft.weər', 'We need to update the software.'),
    card('Hardware', 'Phần cứng', 'ˈhɑːrd.weər', 'The hardware needs to be replaced.'),
    card('Browser', 'Trình duyệt', 'ˈbraʊ.zər', 'Which browser do you use?'),
    card('Password', 'Mật khẩu', 'ˈpæs.wɜːrd', 'Change your password regularly.'),
    card('Download', 'Tải xuống', 'ˈdaʊn.loʊd', 'Download the app from the store.'),
    card('Upload', 'Tải lên', 'ˈʌp.loʊd', 'Upload your photo to the website.'),
    card('Wi-Fi', 'Mạng không dây', 'ˈwaɪ.faɪ', 'What\'s the Wi-Fi password?'),
    card('Cloud storage', 'Lưu trữ đám mây', 'klaʊd ˈstɔːr.ɪdʒ', 'Save your files to cloud storage.'),
    card('Cybersecurity', 'An ninh mạng', 'ˈsaɪ.bər.sɪˌkjʊr.ɪ.ti', 'Cybersecurity is increasingly important.'),
    card('Algorithm', 'Thuật toán', 'ˈæl.ɡə.rɪ.ðəm', 'Social media uses algorithms.'),
    card('Database', 'Cơ sở dữ liệu', 'ˈdeɪ.tə.beɪs', 'The database stores user information.'),
    card('Bandwidth', 'Băng thông', 'ˈbænd.wɪdθ', 'We need more bandwidth for streaming.'),
    card('Artificial intelligence', 'Trí tuệ nhân tạo', 'ˌɑːr.tɪˈfɪʃ.əl ɪnˈtel.ɪ.dʒəns', 'AI is changing the world.'),
    card('Backup', 'Sao lưu', 'ˈbæk.ʌp', 'Always backup your important files.'),
    card('Bug', 'Lỗi phần mềm', 'bʌɡ', 'The developer found a bug in the code.'),
    card('Firewall', 'Tường lửa', 'ˈfaɪr.wɔːl', 'The firewall blocks malicious traffic.'),
    card('Encryption', 'Mã hóa', 'ɪnˈkrɪp.ʃən', 'End-to-end encryption protects your data.'),
    card('Server', 'Máy chủ', 'ˈsɜːr.vər', 'The server is down for maintenance.'),
    card('Streaming', 'Phát trực tuyến', 'ˈstriː.mɪŋ', 'I enjoy streaming movies online.'),
    card('Smartphone', 'Điện thoại thông minh', 'ˈsmɑːrt.foʊn', 'Most people own a smartphone today.'),
  ],
};

// ─── 11. English — Academic Vocabulary (B2) — 20 cards ────────────────────────

const englishAcademic: SeedDeck = {
  title: 'English — Academic Vocabulary',
  description: 'University-level words used in essays, research papers and lectures.',
  language: 'english',
  level: 'B2',
  cards: [
    card('Hypothesis', 'Giả thuyết', 'haɪˈpɒθ.ə.sɪs', 'The hypothesis was supported by the data.'),
    card('Methodology', 'Phương pháp luận', 'ˌmeθ.əˈdɒl.ə.dʒi', 'Explain your research methodology.'),
    card('Analysis', 'Phân tích', 'əˈnæl.ə.sɪs', 'A thorough analysis of the results is needed.'),
    card('Synthesis', 'Tổng hợp', 'ˈsɪn.θə.sɪs', 'The paper provides a synthesis of current research.'),
    card('Empirical', 'Thực nghiệm', 'ɪmˈpɪr.ɪ.kəl', 'The study uses empirical evidence.'),
    card('Theoretical', 'Lý thuyết', 'ˌθɪə.rəˈtɪk.əl', 'This is a theoretical framework.'),
    card('Peer review', 'Bình duyệt đồng nghiệp', 'pɪr rɪˈvjuː', 'The article was published after peer review.'),
    card('Citation', 'Trích dẫn', 'saɪˈteɪ.ʃən', 'Include proper citations in your essay.'),
    card('Abstract', 'Tóm tắt (bài nghiên cứu)', 'ˈæb.strækt', 'Read the abstract before the full paper.'),
    card('Variable', 'Biến số', 'ˈver.i.ə.bəl', 'Control the variables in your experiment.'),
    card('Correlation', 'Tương quan', 'ˌkɒr.əˈleɪ.ʃən', 'There is a strong correlation between the two factors.'),
    card('Phenomenon', 'Hiện tượng', 'fɪˈnɒm.ɪ.nən', 'This phenomenon requires further study.'),
    card('Paradigm', 'Mô hình / khuôn mẫu', 'ˈpær.ə.daɪm', 'A paradigm shift occurred in the field.'),
    card('Qualitative', 'Định tính', 'ˈkwɒl.ɪ.tə.tɪv', 'We conducted qualitative interviews.'),
    card('Quantitative', 'Định lượng', 'ˈkwɒn.tɪ.tə.tɪv', 'Quantitative data was analyzed statistically.'),
    card('Dissertation', 'Luận văn', 'ˌdɪs.ərˈteɪ.ʃən', 'She is writing her doctoral dissertation.'),
    card('Plagiarism', 'Đạo văn', 'ˈpleɪ.dʒər.ɪ.zəm', 'Plagiarism is a serious academic offense.'),
    card('Criteria', 'Tiêu chí', 'kraɪˈtɪr.i.ə', 'What are the criteria for selection?'),
    card('Implication', 'Hàm ý / tác động', 'ˌɪm.plɪˈkeɪ.ʃən', 'Discuss the implications of your findings.'),
    card('Bias', 'Thiên kiến / thành kiến', 'ˈbaɪ.əs', 'Researchers must avoid bias.'),
  ],
};

// ─── 12. English — Idioms & Phrasal Verbs (B2) — 20 cards ────────────────────

const englishIdioms: SeedDeck = {
  title: 'English — Idioms & Phrasal Verbs',
  description: 'Popular English idioms and essential phrasal verbs with meanings.',
  language: 'english',
  level: 'B2',
  cards: [
    card('Break the ice', 'Phá vỡ sự ngại ngùng', undefined, 'He told a joke to break the ice.'),
    card('Hit the nail on the head', 'Nói đúng trọng tâm', undefined, 'You hit the nail on the head with that comment.'),
    card('A piece of cake', 'Dễ như ăn bánh', undefined, 'The test was a piece of cake.'),
    card('Once in a blue moon', 'Hiếm khi / rất hiếm', undefined, 'I only eat fast food once in a blue moon.'),
    card('Under the weather', 'Không khỏe / hơi ốm', undefined, 'I\'m feeling a bit under the weather today.'),
    card('Cost an arm and a leg', 'Rất đắt đỏ', undefined, 'That handbag cost an arm and a leg.'),
    card('Bite the bullet', 'Cắn răng chịu đựng', undefined, 'I had to bite the bullet and apologize.'),
    card('Burn the midnight oil', 'Thức khuya làm việc', undefined, 'Students burn the midnight oil before exams.'),
    card('Look up', 'Tra cứu (từ điển)', 'lʊk ʌp', 'Look up the word in the dictionary.'),
    card('Give up', 'Từ bỏ / bỏ cuộc', 'ɡɪv ʌp', 'Never give up on your dreams.'),
    card('Turn down', 'Từ chối', 'tɜːrn daʊn', 'She turned down the job offer.'),
    card('Put off', 'Trì hoãn / hoãn lại', 'pʊt ɒf', 'Don\'t put off doing your homework.'),
    card('Come up with', 'Nghĩ ra / đưa ra', 'kʌm ʌp wɪð', 'She came up with a brilliant idea.'),
    card('Run out of', 'Hết / cạn kiệt', 'rʌn aʊt ɒv', 'We ran out of milk.'),
    card('Look forward to', 'Mong đợi / trông chờ', 'lʊk ˈfɔːr.wərd tuː', 'I look forward to meeting you.'),
    card('Get along with', 'Hòa thuận với', 'ɡet əˈlɒŋ wɪð', 'I get along with my colleagues.'),
    card('Figure out', 'Tìm ra / hiểu ra', 'ˈfɪɡ.ər aʊt', 'I can\'t figure out this puzzle.'),
    card('Bring up', 'Đề cập / nuôi nấng', 'brɪŋ ʌp', 'Don\'t bring up that topic again.'),
    card('Set up', 'Thiết lập / cài đặt', 'set ʌp', 'Let\'s set up a meeting for Monday.'),
    card('Take after', 'Giống (tính cách/ngoại hình)', 'teɪk ˈæf.tər', 'She takes after her mother.'),
  ],
};

// ─── 13. English — Medical Terminology (C1) — 15 cards ────────────────────────

const englishMedical: SeedDeck = {
  title: 'English — Medical Terminology',
  description: 'Advanced medical terms for healthcare professionals and students.',
  language: 'english',
  level: 'C1',
  cards: [
    card('Diagnosis', 'Chẩn đoán', 'ˌdaɪ.əɡˈnoʊ.sɪs', 'The doctor made an accurate diagnosis.'),
    card('Prognosis', 'Tiên lượng', 'prɒɡˈnoʊ.sɪs', 'The prognosis is positive with treatment.'),
    card('Symptom', 'Triệu chứng', 'ˈsɪmp.təm', 'Fever is a common symptom of infection.'),
    card('Chronic', 'Mãn tính', 'ˈkrɒn.ɪk', 'He suffers from chronic back pain.'),
    card('Acute', 'Cấp tính', 'əˈkjuːt', 'She was admitted with acute appendicitis.'),
    card('Inflammation', 'Viêm', 'ˌɪn.fləˈmeɪ.ʃən', 'Inflammation causes redness and swelling.'),
    card('Prescription', 'Đơn thuốc', 'prɪˈskrɪp.ʃən', 'The doctor wrote a prescription for antibiotics.'),
    card('Dosage', 'Liều lượng', 'ˈdoʊ.sɪdʒ', 'Follow the recommended dosage.'),
    card('Anesthesia', 'Gây mê / gây tê', 'ˌæn.əsˈθiː.zi.ə', 'The patient was given general anesthesia.'),
    card('Pathogen', 'Mầm bệnh', 'ˈpæθ.ə.dʒən', 'Bacteria and viruses are common pathogens.'),
    card('Benign', 'Lành tính', 'bɪˈnaɪn', 'The tumor was found to be benign.'),
    card('Malignant', 'Ác tính', 'məˈlɪɡ.nənt', 'The biopsy revealed a malignant growth.'),
    card('Cardiac', 'Thuộc về tim', 'ˈkɑːr.di.æk', 'He had a cardiac arrest last year.'),
    card('Neurological', 'Thuộc thần kinh', 'ˌnʊr.əˈlɒdʒ.ɪ.kəl', 'The neurological examination was normal.'),
    card('Rehabilitation', 'Phục hồi chức năng', 'ˌriː.hə.bɪl.ɪˈteɪ.ʃən', 'Rehabilitation takes several months after surgery.'),
  ],
};

// ─── 14. English — Legal & Financial Terms (C1) — 15 cards ────────────────────

const englishLegal: SeedDeck = {
  title: 'English — Legal & Financial Terms',
  description: 'Advanced vocabulary for law and finance contexts.',
  language: 'english',
  level: 'C1',
  cards: [
    card('Contract', 'Hợp đồng', 'ˈkɒn.trækt', 'Both parties signed the contract.'),
    card('Liability', 'Trách nhiệm pháp lý / nợ', 'ˌlaɪ.əˈbɪl.ɪ.ti', 'The company has limited liability.'),
    card('Plaintiff', 'Nguyên đơn', 'ˈpleɪn.tɪf', 'The plaintiff filed a lawsuit.'),
    card('Defendant', 'Bị đơn / bị cáo', 'dɪˈfen.dənt', 'The defendant pleaded not guilty.'),
    card('Jurisdiction', 'Quyền tài phán / thẩm quyền', 'ˌdʒʊr.ɪsˈdɪk.ʃən', 'This falls under federal jurisdiction.'),
    card('Collateral', 'Tài sản thế chấp', 'kəˈlæt.ər.əl', 'The bank requires collateral for the loan.'),
    card('Dividend', 'Cổ tức', 'ˈdɪv.ɪ.dend', 'Shareholders receive dividends quarterly.'),
    card('Equity', 'Vốn chủ sở hữu', 'ˈek.wɪ.ti', 'The company has strong equity.'),
    card('Mortgage', 'Thế chấp (nhà)', 'ˈmɔːr.ɡɪdʒ', 'They took out a 30-year mortgage.'),
    card('Inflation', 'Lạm phát', 'ɪnˈfleɪ.ʃən', 'Inflation has risen sharply this year.'),
    card('Audit', 'Kiểm toán', 'ˈɔː.dɪt', 'The company undergoes an annual audit.'),
    card('Compliance', 'Tuân thủ (quy định)', 'kəmˈplaɪ.əns', 'Ensure compliance with local regulations.'),
    card('Intellectual property', 'Sở hữu trí tuệ', 'ˌɪn.təˈlek.tʃu.əl ˈprɒp.ər.ti', 'Protect your intellectual property rights.'),
    card('Due diligence', 'Thẩm định', 'djuː ˈdɪl.ɪ.dʒəns', 'Due diligence was conducted before the merger.'),
    card('Bankruptcy', 'Phá sản', 'ˈbæŋk.rʌpt.si', 'The company filed for bankruptcy.'),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ██ JAPANESE DECKS (8 decks)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Japanese — Hiragana Vowels & K-row (N5) — 15 cards ───────────────────

const jpHiragana: SeedDeck = {
  title: 'Japanese — Hiragana Vowels & K-row',
  description: 'First 15 hiragana characters: vowels (あ行), K-row (か行) and S-row (さ行).',
  language: 'japanese',
  level: 'N5',
  cards: [
    card('あ', 'a — nguyên âm', 'a', 'あさ (asa) — buổi sáng'),
    card('い', 'i — nguyên âm', 'i', 'いぬ (inu) — con chó'),
    card('う', 'u — nguyên âm', 'ɯ', 'うみ (umi) — biển'),
    card('え', 'e — nguyên âm', 'e', 'えき (eki) — ga tàu'),
    card('お', 'o — nguyên âm', 'o', 'おかね (okane) — tiền'),
    card('か', 'ka', 'ka', 'かさ (kasa) — ô / dù'),
    card('き', 'ki', 'ki', 'きって (kitte) — tem thư'),
    card('く', 'ku', 'kɯ', 'くつ (kutsu) — giày'),
    card('け', 'ke', 'ke', 'けさ (kesa) — sáng nay'),
    card('こ', 'ko', 'ko', 'こども (kodomo) — trẻ em'),
    card('さ', 'sa', 'sa', 'さかな (sakana) — cá'),
    card('し', 'shi', 'ɕi', 'しんぶん (shinbun) — báo'),
    card('す', 'su', 'sɯ', 'すし (sushi) — sushi'),
    card('せ', 'se', 'se', 'せんせい (sensei) — giáo viên'),
    card('そ', 'so', 'so', 'そと (soto) — bên ngoài'),
  ],
};

// ─── 2. Japanese — JLPT N5 Core Vocabulary (N5) — 25 cards ───────────────────

const jpN5Vocab: SeedDeck = {
  title: 'Japanese — JLPT N5 Core Vocabulary',
  description: 'High-frequency nouns, adjectives and verbs from the JLPT N5 list.',
  language: 'japanese',
  level: 'N5',
  cards: [
    card('こんにちは', 'Xin chào (ban ngày)', 'konnichiwa', 'こんにちは、元気ですか。'),
    card('ありがとう', 'Cảm ơn', 'arigatō', 'ありがとうございます。'),
    card('すみません', 'Xin lỗi / Cho hỏi', 'sumimasen', 'すみません、駅はどこですか。'),
    card('はい', 'Vâng / Có', 'hai', 'はい、わかりました。'),
    card('いいえ', 'Không', 'iie', 'いいえ、違います。'),
    card('わたし', 'Tôi (私)', 'watashi', 'わたしは学生です。'),
    card('あなた', 'Bạn', 'anata', 'あなたの名前は何ですか。'),
    card('せんせい', 'Giáo viên (先生)', 'sensei', '先生はとてもやさしいです。'),
    card('がくせい', 'Học sinh (学生)', 'gakusei', 'がくせいが三人います。'),
    card('みず', 'Nước (水)', 'mizu', 'みずをください。'),
    card('たべる', 'Ăn (食べる)', 'taberu', 'パンを食べる。'),
    card('のむ', 'Uống (飲む)', 'nomu', 'コーヒーを飲む。'),
    card('いく', 'Đi (行く)', 'iku', '学校に行く。'),
    card('くる', 'Đến (来る)', 'kuru', '友達が来る。'),
    card('みる', 'Nhìn / Xem (見る)', 'miru', 'テレビを見る。'),
    card('かう', 'Mua (買う)', 'kau', '本を買う。'),
    card('いえ', 'Nhà (家)', 'ie', 'いえに帰ります。'),
    card('がっこう', 'Trường học (学校)', 'gakkō', 'がっこうは近いです。'),
    card('でんしゃ', 'Tàu điện (電車)', 'densha', 'でんしゃで行きます。'),
    card('くるま', 'Xe hơi (車)', 'kuruma', 'あかいくるまが好きです。'),
    card('ほん', 'Sách (本)', 'hon', 'ほんを読みます。'),
    card('しんぶん', 'Báo (新聞)', 'shinbun', '毎朝しんぶんを読む。'),
    card('おおきい', 'To, lớn (大きい)', 'ōkii', 'この家は大きいです。'),
    card('ちいさい', 'Nhỏ (小さい)', 'chiisai', 'ちいさい猫がいます。'),
    card('あたらしい', 'Mới (新しい)', 'atarashii', 'あたらしいかばんを買いました。'),
  ],
};

// ─── 3. Japanese — JLPT N5 Common Verbs (N5) — 20 cards ──────────────────────

const jpN5Verbs: SeedDeck = {
  title: 'Japanese — JLPT N5 Common Verbs',
  description: 'Twenty essential verbs with their dictionary form and meaning.',
  language: 'japanese',
  level: 'N5',
  cards: [
    card('はなす', 'Nói chuyện (話す)', 'hanasu', '日本語を話す。'),
    card('きく', 'Nghe / Hỏi (聞く)', 'kiku', '音楽を聞く。'),
    card('よむ', 'Đọc (読む)', 'yomu', '本を読む。'),
    card('かく', 'Viết (書く)', 'kaku', '手紙を書く。'),
    card('あう', 'Gặp (会う)', 'au', '友達に会う。'),
    card('まつ', 'Đợi (待つ)', 'matsu', 'バスを待つ。'),
    card('しる', 'Biết (知る)', 'shiru', 'その人を知っていますか。'),
    card('わかる', 'Hiểu (分かる)', 'wakaru', '意味がわかる。'),
    card('おきる', 'Thức dậy (起きる)', 'okiru', '毎朝六時に起きる。'),
    card('ねる', 'Ngủ (寝る)', 'neru', '十一時に寝る。'),
    card('はたらく', 'Làm việc (働く)', 'hataraku', '会社で働く。'),
    card('やすむ', 'Nghỉ ngơi (休む)', 'yasumu', '今日は休む。'),
    card('あるく', 'Đi bộ (歩く)', 'aruku', '公園を歩く。'),
    card('はしる', 'Chạy (走る)', 'hashiru', '毎日走る。'),
    card('およぐ', 'Bơi (泳ぐ)', 'oyogu', 'プールで泳ぐ。'),
    card('うたう', 'Hát (歌う)', 'utau', '歌を歌う。'),
    card('おどる', 'Nhảy múa (踊る)', 'odoru', '一緒に踊りましょう。'),
    card('わすれる', 'Quên (忘れる)', 'wasureru', '名前を忘れた。'),
    card('おぼえる', 'Nhớ / Học thuộc (覚える)', 'oboeru', '漢字を覚える。'),
    card('つくる', 'Làm / Chế tạo (作る)', 'tsukuru', '料理を作る。'),
  ],
};

// ─── 4. Japanese — Daily Life Phrases (N4) — 15 cards ─────────────────────────

const jpDailyPhrases: SeedDeck = {
  title: 'Japanese — Daily Life Phrases',
  description: 'Polite phrases used at home, school and work.',
  language: 'japanese',
  level: 'N4',
  cards: [
    card('いってきます', 'Tôi đi đây (khi rời nhà)', 'ittekimasu', '朝、家を出るとき「いってきます」。'),
    card('いってらっしゃい', 'Đi nhé (đáp lại ittekimasu)', 'itterasshai'),
    card('ただいま', 'Tôi về rồi', 'tadaima', '家に帰って「ただいま」。'),
    card('おかえりなさい', 'Chào mừng về nhà', 'okaerinasai'),
    card('いただきます', 'Mời ăn (trước bữa)', 'itadakimasu', '食事の前に「いただきます」と言います。'),
    card('ごちそうさまでした', 'Cảm ơn vì bữa ăn', 'gochisōsama deshita'),
    card('おつかれさまでした', 'Anh/chị đã vất vả rồi', 'otsukaresama deshita', '仕事の後で「おつかれさまでした」。'),
    card('しつれいします', 'Xin phép (vào/ra phòng)', 'shitsurei shimasu'),
    card('おやすみなさい', 'Chúc ngủ ngon', 'oyasuminasai', '寝る前に「おやすみなさい」。'),
    card('だいじょうぶです', 'Không sao đâu', 'daijōbu desu', 'A:「大丈夫ですか？」 B:「大丈夫です。」'),
    card('ちょっとまってください', 'Vui lòng đợi một chút', 'chotto matte kudasai'),
    card('もういちどおねがいします', 'Xin nhắc lại lần nữa', 'mō ichido onegaishimasu'),
    card('わかりました', 'Tôi hiểu rồi', 'wakarimashita', '先生：「宿題を出してください。」 学生：「わかりました。」'),
    card('わかりません', 'Tôi không hiểu', 'wakarimasen', 'すみません、わかりません。'),
    card('おねがいします', 'Xin vui lòng / nhờ anh/chị', 'onegaishimasu', 'これをお願いします。'),
  ],
};

// ─── 5. Japanese — Katakana Essentials (N5) — 20 cards ────────────────────────

const jpKatakana: SeedDeck = {
  title: 'Japanese — Katakana Essentials',
  description: 'Common katakana loanwords used in everyday Japanese life.',
  language: 'japanese',
  level: 'N5',
  cards: [
    card('コーヒー', 'Cà phê (coffee)', 'kōhī', 'コーヒーを一杯ください。'),
    card('テレビ', 'Ti vi (television)', 'terebi', 'テレビを見ます。'),
    card('パソコン', 'Máy tính (personal computer)', 'pasokon', 'パソコンで仕事をする。'),
    card('スマホ', 'Điện thoại thông minh (smartphone)', 'sumaho', 'スマホで写真を撮る。'),
    card('レストラン', 'Nhà hàng (restaurant)', 'resutoran', 'レストランで食べましょう。'),
    card('ホテル', 'Khách sạn (hotel)', 'hoteru', 'ホテルを予約した。'),
    card('タクシー', 'Taxi', 'takushī', 'タクシーで行きます。'),
    card('バス', 'Xe buýt (bus)', 'basu', 'バスに乗ります。'),
    card('エレベーター', 'Thang máy (elevator)', 'erebētā', 'エレベーターで五階に行きます。'),
    card('トイレ', 'Nhà vệ sinh (toilet)', 'toire', 'トイレはどこですか。'),
    card('ビール', 'Bia (beer)', 'bīru', 'ビールを二本ください。'),
    card('パン', 'Bánh mì (bread/pain)', 'pan', '毎朝パンを食べる。'),
    card('ケーキ', 'Bánh kem (cake)', 'kēki', '誕生日のケーキを作った。'),
    card('サラダ', 'Salad', 'sarada', 'サラダを注文しました。'),
    card('ニュース', 'Tin tức (news)', 'nyūsu', '毎日ニュースを見ます。'),
    card('インターネット', 'Internet', 'intānetto', 'インターネットで調べる。'),
    card('メール', 'Email / thư điện tử', 'mēru', 'メールを送ってください。'),
    card('シャワー', 'Vòi sen (shower)', 'shawā', 'シャワーを浴びる。'),
    card('アルバイト', 'Việc làm thêm (part-time job)', 'arubaito', 'アルバイトを探しています。'),
    card('プレゼント', 'Quà tặng (present)', 'purezento', '友達にプレゼントをあげた。'),
  ],
};

// ─── 6. Japanese — JLPT N4 Adjectives (N4) — 20 cards ────────────────────────

const jpN4Adjectives: SeedDeck = {
  title: 'Japanese — JLPT N4 Adjectives',
  description: 'i-adjectives and na-adjectives commonly tested at JLPT N4 level.',
  language: 'japanese',
  level: 'N4',
  cards: [
    card('うれしい', 'Vui mừng (嬉しい)', 'ureshii', 'プレゼントをもらってうれしい。'),
    card('かなしい', 'Buồn (悲しい)', 'kanashii', 'かなしい映画を見た。'),
    card('つまらない', 'Chán / nhàm chán', 'tsumaranai', 'この番組はつまらない。'),
    card('おもしろい', 'Thú vị / vui (面白い)', 'omoshiroi', 'この本はとてもおもしろい。'),
    card('むずかしい', 'Khó (難しい)', 'muzukashii', 'この問題はむずかしい。'),
    card('やさしい', 'Dễ / hiền lành (優しい)', 'yasashii', '先生はやさしいです。'),
    card('あぶない', 'Nguy hiểm (危ない)', 'abunai', 'ここはあぶないです。'),
    card('すごい', 'Tuyệt vời / ghê gớm', 'sugoi', 'すごいですね！'),
    card('はずかしい', 'Xấu hổ / ngượng (恥ずかしい)', 'hazukashii', 'みんなの前ではずかしかった。'),
    card('さびしい', 'Cô đơn (寂しい)', 'sabishii', '一人でさびしい。'),
    card('きれい（な）', 'Đẹp / sạch sẽ (綺麗)', 'kirei', 'この花はきれいです。'),
    card('しずか（な）', 'Yên tĩnh (静か)', 'shizuka', '図書館はしずかです。'),
    card('にぎやか（な）', 'Nhộn nhịp / sôi nổi (賑やか)', 'nigiyaka', 'この街はにぎやかです。'),
    card('べんり（な）', 'Tiện lợi (便利)', 'benri', '駅の近くはべんりです。'),
    card('ふべん（な）', 'Bất tiện (不便)', 'fuben', 'バスがないのでふべんです。'),
    card('ひま（な）', 'Rảnh rỗi (暇)', 'hima', '明日はひまです。'),
    card('じょうず（な）', 'Giỏi / khéo (上手)', 'jōzu', '日本語がじょうずですね。'),
    card('へた（な）', 'Dở / vụng (下手)', 'heta', '料理がへたです。'),
    card('げんき（な）', 'Khỏe mạnh / năng động (元気)', 'genki', 'お元気ですか。'),
    card('たいせつ（な）', 'Quan trọng (大切)', 'taisetsu', '家族はたいせつです。'),
  ],
};

// ─── 7. Japanese — Japanese Counters (N5) — 15 cards ──────────────────────────

const jpCounters: SeedDeck = {
  title: 'Japanese — Japanese Counters',
  description: 'Essential counting words (助数詞) used for different types of objects.',
  language: 'japanese',
  level: 'N5',
  cards: [
    card('ひとつ', 'Một (cái — đếm chung)', 'hitotsu', 'りんごをひとつください。'),
    card('ふたつ', 'Hai (cái — đếm chung)', 'futatsu', 'ケーキをふたつ食べた。'),
    card('みっつ', 'Ba (cái — đếm chung)', 'mittsu'),
    card('よっつ', 'Bốn (cái — đếm chung)', 'yottsu'),
    card('いつつ', 'Năm (cái — đếm chung)', 'itsutsu'),
    card('〜人 (ひとり)', 'Một người', 'hitori', 'ひとりで行きます。'),
    card('〜人 (ふたり)', 'Hai người', 'futari', 'ふたりで食べました。'),
    card('〜人 (さんにん)', 'Ba người', 'sannin', '三人の学生がいます。'),
    card('〜本 (いっぽん)', 'Một (cây / chai — vật dài)', 'ippon', 'ペンを一本ください。'),
    card('〜枚 (いちまい)', 'Một (tờ — vật phẳng)', 'ichimai', '紙を一枚もらった。'),
    card('〜冊 (いっさつ)', 'Một (quyển — sách)', 'issatsu', '本を一冊買った。'),
    card('〜匹 (いっぴき)', 'Một (con — động vật nhỏ)', 'ippiki', '猫が一匹います。'),
    card('〜台 (いちだい)', 'Một (chiếc — xe / máy)', 'ichidai', '車が一台あります。'),
    card('〜杯 (いっぱい)', 'Một (ly / chén)', 'ippai', 'コーヒーを一杯飲む。'),
    card('〜階 (いっかい)', 'Tầng một', 'ikkai', 'トイレは一階にあります。'),
  ],
};

// ─── 8. Japanese — Restaurant & Shopping (N4) — 20 cards ──────────────────────

const jpRestaurant: SeedDeck = {
  title: 'Japanese — Restaurant & Shopping',
  description: 'Phrases and vocabulary for ordering food and shopping in Japan.',
  language: 'japanese',
  level: 'N4',
  cards: [
    card('メニューをください', 'Cho tôi xem thực đơn', 'menyū o kudasai'),
    card('おすすめは何ですか', 'Món gì được khuyên dùng?', 'osusume wa nan desu ka'),
    card('これをください', 'Cho tôi cái này', 'kore o kudasai', '「これをください。」「はい、少々お待ちください。」'),
    card('お会計おねがいします', 'Cho tôi tính tiền', 'okaikei onegaishimasu'),
    card('いくらですか', 'Bao nhiêu tiền?', 'ikura desu ka', 'このかばんはいくらですか。'),
    card('高い', 'Đắt (たかい)', 'takai', 'この服は高いです。'),
    card('安い', 'Rẻ (やすい)', 'yasui', 'この店は安いです。'),
    card('大きいサイズ', 'Cỡ lớn', 'ōkii saizu', '大きいサイズはありますか。'),
    card('小さいサイズ', 'Cỡ nhỏ', 'chiisai saizu'),
    card('試着してもいいですか', 'Tôi có thể thử không?', 'shichaku shite mo ii desu ka'),
    card('カードで払えますか', 'Có trả bằng thẻ được không?', 'kādo de haraemasu ka'),
    card('現金', 'Tiền mặt (げんきん)', 'genkin', '現金でお願いします。'),
    card('レシート', 'Hóa đơn / biên lai', 'reshīto', 'レシートをください。'),
    card('お水', 'Nước lọc (おみず)', 'omizu', 'お水をいただけますか。'),
    card('お箸', 'Đũa (おはし)', 'ohashi', 'お箸をもう一膳ください。'),
    card('持ち帰り', 'Mang về (もちかえり)', 'mochikaeri', '持ち帰りでお願いします。'),
    card('ここで食べます', 'Ăn tại đây', 'koko de tabemasu'),
    card('おいしい', 'Ngon', 'oishii', 'このラーメンはおいしいです。'),
    card('辛い', 'Cay (からい)', 'karai', 'この料理は辛いですか。'),
    card('甘い', 'Ngọt (あまい)', 'amai', 'このケーキは甘いです。'),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ██ CHINESE DECKS (8 decks)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Chinese — Pinyin Foundations (HSK1) — 20 cards ────────────────────────

const zhPinyin: SeedDeck = {
  title: 'Chinese — Pinyin Foundations',
  description: 'Master the four tones and essential initial sounds of Mandarin Chinese.',
  language: 'chinese',
  level: 'HSK1',
  cards: [
    card('妈', 'Mẹ', 'mā', '我的妈妈很好。(Mẹ tôi rất tốt.)'),
    card('麻', 'Gai dầu / tê', 'má', '这是麻的。(Cái này tê tê.)'),
    card('马', 'Ngựa', 'mǎ', '那是一匹马。(Đó là một con ngựa.)'),
    card('骂', 'Mắng / chửi', 'mà', '他骂了我。(Anh ấy mắng tôi.)'),
    card('爸', 'Bố / Ba', 'bà', '爸爸在家。(Bố ở nhà.)'),
    card('八', 'Số tám', 'bā', '八个人。(Tám người.)'),
    card('大', 'To / lớn', 'dà', '大房子。(Ngôi nhà lớn.)'),
    card('打', 'Đánh / gọi (điện)', 'dǎ', '打电话。(Gọi điện thoại.)'),
    card('吃', 'Ăn', 'chī', '我吃饭。(Tôi ăn cơm.)'),
    card('喝', 'Uống', 'hē', '喝水。(Uống nước.)'),
    card('好', 'Tốt / khỏe', 'hǎo', '你好！(Xin chào!)'),
    card('是', 'Là', 'shì', '我是学生。(Tôi là học sinh.)'),
    card('不', 'Không', 'bù', '不好。(Không tốt.)'),
    card('的', 'Trợ từ sở hữu (của)', 'de', '我的书。(Sách của tôi.)'),
    card('我', 'Tôi', 'wǒ', '我叫小明。(Tôi tên Tiểu Minh.)'),
    card('你', 'Bạn', 'nǐ', '你好吗？(Bạn khỏe không?)'),
    card('他', 'Anh ấy', 'tā', '他是老师。(Anh ấy là giáo viên.)'),
    card('她', 'Cô ấy', 'tā', '她很漂亮。(Cô ấy rất xinh.)'),
    card('们', 'Hậu tố số nhiều', 'men', '我们是朋友。(Chúng tôi là bạn.)'),
    card('什么', 'Cái gì', 'shénme', '这是什么？(Cái này là gì?)'),
  ],
};

// ─── 2. Chinese — HSK 1 Core Vocabulary (HSK1) — 25 cards ────────────────────

const zhHsk1Vocab: SeedDeck = {
  title: 'Chinese — HSK 1 Core Vocabulary',
  description: 'Twenty-five must-know words for the HSK 1 exam.',
  language: 'chinese',
  level: 'HSK1',
  cards: [
    card('你好', 'Xin chào', 'nǐ hǎo', '你好，我叫阿明。'),
    card('再见', 'Tạm biệt', 'zài jiàn', '明天再见！'),
    card('谢谢', 'Cảm ơn', 'xiè xie', '谢谢你的帮助。'),
    card('对不起', 'Xin lỗi', 'duì bu qǐ', '对不起，我迟到了。'),
    card('没关系', 'Không sao', 'méi guān xi', '没关系，没问题。'),
    card('请', 'Xin / mời', 'qǐng', '请坐。(Mời ngồi.)'),
    card('老师', 'Giáo viên', 'lǎo shī', '老师教我们汉语。'),
    card('学生', 'Học sinh', 'xué shēng', '我是大学生。'),
    card('朋友', 'Bạn bè', 'péng you', '他是我的好朋友。'),
    card('中国', 'Trung Quốc', 'zhōng guó', '中国很大。'),
    card('越南', 'Việt Nam', 'yuè nán', '我来自越南。'),
    card('家', 'Nhà / gia đình', 'jiā', '我的家在河内。'),
    card('学校', 'Trường học', 'xué xiào', '学校很大。'),
    card('医院', 'Bệnh viện', 'yī yuàn', '医院在那边。'),
    card('饭店', 'Nhà hàng', 'fàn diàn', '我们去饭店吃饭。'),
    card('水', 'Nước', 'shuǐ', '请给我一杯水。'),
    card('茶', 'Trà', 'chá', '你喝茶吗？'),
    card('饭', 'Cơm', 'fàn', '吃饭了吗？'),
    card('苹果', 'Táo', 'píng guǒ', '我喜欢吃苹果。'),
    card('书', 'Sách', 'shū', '这本书很好。'),
    card('电脑', 'Máy tính', 'diàn nǎo', '我用电脑工作。'),
    card('手机', 'Điện thoại di động', 'shǒu jī', '手机在桌子上。'),
    card('钱', 'Tiền', 'qián', '这个多少钱？'),
    card('工作', 'Công việc / làm việc', 'gōng zuò', '我在公司工作。'),
    card('爱', 'Yêu', 'ài', '我爱你。'),
  ],
};

// ─── 3. Chinese — HSK 2 Expansion (HSK2) — 20 cards ──────────────────────────

const zhHsk2Words: SeedDeck = {
  title: 'Chinese — HSK 2 Expansion',
  description: 'Twenty new words building on HSK 1, focused on routines and feelings.',
  language: 'chinese',
  level: 'HSK2',
  cards: [
    card('早上', 'Buổi sáng', 'zǎo shang', '早上好！(Chào buổi sáng!)'),
    card('中午', 'Buổi trưa', 'zhōng wǔ', '中午吃什么？'),
    card('晚上', 'Buổi tối', 'wǎn shang', '晚上我看电视。'),
    card('昨天', 'Hôm qua', 'zuó tiān', '昨天很冷。'),
    card('今天', 'Hôm nay', 'jīn tiān', '今天天气很好。'),
    card('明天', 'Ngày mai', 'míng tiān', '明天见！'),
    card('星期', 'Tuần', 'xīng qī', '一个星期有七天。'),
    card('月', 'Tháng', 'yuè', '一月是新年。'),
    card('累', 'Mệt', 'lèi', '工作一天很累。'),
    card('忙', 'Bận', 'máng', '你忙吗？'),
    card('快乐', 'Vui vẻ', 'kuài lè', '祝你生日快乐！'),
    card('生气', 'Tức giận', 'shēng qì', '不要生气。'),
    card('便宜', 'Rẻ', 'pián yi', '这个很便宜。'),
    card('贵', 'Đắt', 'guì', '太贵了！(Đắt quá!)'),
    card('近', 'Gần', 'jìn', '学校离这里很近。'),
    card('远', 'Xa', 'yuǎn', '机场很远。'),
    card('开始', 'Bắt đầu', 'kāi shǐ', '会议开始了。'),
    card('结束', 'Kết thúc', 'jié shù', '电影结束了。'),
    card('知道', 'Biết', 'zhī dao', '我知道了。'),
    card('觉得', 'Cảm thấy / cho rằng', 'jué de', '你觉得怎么样？'),
  ],
};

// ─── 4. Chinese — Numbers & Time (HSK1) — 20 cards ───────────────────────────

const zhNumbersTime: SeedDeck = {
  title: 'Chinese — Numbers & Time',
  description: 'Numbers 1-10, days of the week and times of day.',
  language: 'chinese',
  level: 'HSK1',
  cards: [
    card('一', 'Một', 'yī', '一个人。(Một người.)'),
    card('二', 'Hai', 'èr', '二楼。(Tầng hai.)'),
    card('三', 'Ba', 'sān', '三本书。(Ba quyển sách.)'),
    card('四', 'Bốn', 'sì', '四月。(Tháng tư.)'),
    card('五', 'Năm', 'wǔ', '五块钱。(Năm đồng.)'),
    card('六', 'Sáu', 'liù', '六点。(Sáu giờ.)'),
    card('七', 'Bảy', 'qī', '七月七号。(Ngày 7 tháng 7.)'),
    card('八', 'Tám', 'bā', '八十八。(Tám mươi tám.)'),
    card('九', 'Chín', 'jiǔ', '九月开学。(Tháng 9 khai giảng.)'),
    card('十', 'Mười', 'shí', '十分钟。(Mười phút.)'),
    card('星期一', 'Thứ Hai', 'xīng qī yī', '星期一上班。'),
    card('星期二', 'Thứ Ba', 'xīng qī èr'),
    card('星期三', 'Thứ Tư', 'xīng qī sān'),
    card('星期四', 'Thứ Năm', 'xīng qī sì'),
    card('星期五', 'Thứ Sáu', 'xīng qī wǔ', '星期五下班早。'),
    card('星期六', 'Thứ Bảy', 'xīng qī liù', '星期六去购物。'),
    card('星期天', 'Chủ nhật', 'xīng qī tiān', '星期天休息。'),
    card('点', 'Giờ (đồng hồ)', 'diǎn', '现在三点。(Bây giờ 3 giờ.)'),
    card('分', 'Phút', 'fēn', '十分钟。(10 phút.)'),
    card('小时', 'Tiếng đồng hồ', 'xiǎo shí', '两个小时。(2 tiếng.)'),
  ],
};

// ─── 5. Chinese — HSK 3 Intermediate (HSK3) — 20 cards ───────────────────────

const zhHsk3: SeedDeck = {
  title: 'Chinese — HSK 3 Intermediate',
  description: 'Intermediate vocabulary covering work, relationships and daily activities.',
  language: 'chinese',
  level: 'HSK3',
  cards: [
    card('经常', 'Thường xuyên', 'jīng cháng', '我经常运动。(Tôi thường xuyên tập thể dục.)'),
    card('一直', 'Luôn luôn / suốt', 'yī zhí', '我一直在等你。(Tôi suốt chờ bạn.)'),
    card('已经', 'Đã (rồi)', 'yǐ jīng', '我已经到了。(Tôi đã đến rồi.)'),
    card('虽然...但是', 'Mặc dù... nhưng', 'suī rán...dàn shì', '虽然很累，但是很开心。'),
    card('如果', 'Nếu', 'rú guǒ', '如果下雨，我就不去了。'),
    card('环境', 'Môi trường', 'huán jìng', '这里的环境很好。'),
    card('关心', 'Quan tâm', 'guān xīn', '谢谢你关心我。'),
    card('决定', 'Quyết định', 'jué dìng', '我决定去中国留学。'),
    card('提高', 'Nâng cao', 'tí gāo', '我想提高我的汉语水平。'),
    card('比较', 'So sánh / khá', 'bǐ jiào', '今天比较冷。(Hôm nay khá lạnh.)'),
    card('影响', 'Ảnh hưởng', 'yǐng xiǎng', '天气影响了我的心情。'),
    card('解决', 'Giải quyết', 'jiě jué', '我们要解决这个问题。'),
    card('练习', 'Luyện tập', 'liàn xí', '每天练习说汉语。'),
    card('需要', 'Cần', 'xū yào', '我需要你的帮助。'),
    card('重要', 'Quan trọng', 'zhòng yào', '健康最重要。'),
    card('简单', 'Đơn giản', 'jiǎn dān', '这个问题很简单。'),
    card('复杂', 'Phức tạp', 'fù zá', '这件事很复杂。'),
    card('方便', 'Tiện lợi', 'fāng biàn', '这里交通很方便。'),
    card('机会', 'Cơ hội', 'jī huì', '这是一个好机会。'),
    card('经验', 'Kinh nghiệm', 'jīng yàn', '他有很多工作经验。'),
  ],
};

// ─── 6. Chinese — Chinese Measure Words (HSK2) — 15 cards ────────────────────

const zhMeasureWords: SeedDeck = {
  title: 'Chinese — Chinese Measure Words',
  description: 'Essential measure words (量词) required for counting in Chinese.',
  language: 'chinese',
  level: 'HSK2',
  cards: [
    card('个', 'Cái (lượng từ chung)', 'gè', '一个人。(Một người.)'),
    card('本', 'Quyển (sách)', 'běn', '三本书。(Ba quyển sách.)'),
    card('杯', 'Ly / cốc', 'bēi', '一杯咖啡。(Một ly cà phê.)'),
    card('瓶', 'Chai', 'píng', '两瓶水。(Hai chai nước.)'),
    card('块', 'Miếng / đồng (tiền)', 'kuài', '一块蛋糕。(Một miếng bánh.)'),
    card('件', 'Cái (quần áo / việc)', 'jiàn', '一件衣服。(Một cái áo.)'),
    card('双', 'Đôi', 'shuāng', '一双鞋。(Một đôi giày.)'),
    card('条', 'Con (cá) / cái (đường)', 'tiáo', '一条鱼。(Một con cá.)'),
    card('张', 'Tờ / tấm (vật phẳng)', 'zhāng', '一张纸。(Một tờ giấy.)'),
    card('只', 'Con (động vật nhỏ)', 'zhī', '一只猫。(Một con mèo.)'),
    card('辆', 'Chiếc (xe)', 'liàng', '一辆车。(Một chiếc xe.)'),
    card('位', 'Vị (người — lịch sự)', 'wèi', '三位客人。(Ba vị khách.)'),
    card('次', 'Lần', 'cì', '第一次。(Lần đầu tiên.)'),
    card('碗', 'Tô / bát', 'wǎn', '一碗面。(Một tô mì.)'),
    card('种', 'Loại', 'zhǒng', '两种方法。(Hai loại phương pháp.)'),
  ],
};

// ─── 7. Chinese — Chinese Food & Dining (HSK1) — 20 cards ────────────────────

const zhFood: SeedDeck = {
  title: 'Chinese — Chinese Food & Dining',
  description: 'Common food items and dining vocabulary for beginners.',
  language: 'chinese',
  level: 'HSK1',
  cards: [
    card('米饭', 'Cơm', 'mǐ fàn', '我要一碗米饭。'),
    card('面条', 'Mì sợi', 'miàn tiáo', '我喜欢吃面条。'),
    card('饺子', 'Sủi cảo', 'jiǎo zi', '我们包饺子吧。'),
    card('包子', 'Bánh bao', 'bāo zi', '早上吃包子。'),
    card('豆腐', 'Đậu phụ', 'dòu fu', '麻婆豆腐很好吃。'),
    card('鸡肉', 'Thịt gà', 'jī ròu', '宫保鸡丁很有名。'),
    card('猪肉', 'Thịt lợn', 'zhū ròu', '红烧猪肉。(Thịt lợn kho tàu.)'),
    card('牛肉', 'Thịt bò', 'niú ròu', '牛肉面。(Mì bò.)'),
    card('鱼', 'Cá', 'yú', '清蒸鱼。(Cá hấp.)'),
    card('蔬菜', 'Rau', 'shū cài', '多吃蔬菜。'),
    card('水果', 'Trái cây', 'shuǐ guǒ', '水果很新鲜。'),
    card('筷子', 'Đũa', 'kuài zi', '你会用筷子吗？'),
    card('碗', 'Bát / tô', 'wǎn', '给我一个碗。'),
    card('盘子', 'Đĩa', 'pán zi', '盘子里有菜。'),
    card('好吃', 'Ngon', 'hǎo chī', '这个菜很好吃！'),
    card('辣', 'Cay', 'là', '我不能吃辣的。'),
    card('甜', 'Ngọt', 'tián', '这个蛋糕很甜。'),
    card('咸', 'Mặn', 'xián', '太咸了。(Mặn quá.)'),
    card('酸', 'Chua', 'suān', '酸辣汤。(Canh chua cay.)'),
    card('服务员', 'Nhân viên phục vụ', 'fú wù yuán', '服务员，买单。(Phục vụ, tính tiền.)'),
  ],
};

// ─── 8. Chinese — Chinese Directions & Transport (HSK2) — 15 cards ────────────

const zhDirections: SeedDeck = {
  title: 'Chinese — Chinese Directions & Transport',
  description: 'Asking for directions and using public transport in Chinese.',
  language: 'chinese',
  level: 'HSK2',
  cards: [
    card('左边', 'Bên trái', 'zuǒ biān', '超市在左边。(Siêu thị ở bên trái.)'),
    card('右边', 'Bên phải', 'yòu biān', '银行在右边。'),
    card('前面', 'Phía trước', 'qián miàn', '学校在前面。'),
    card('后面', 'Phía sau', 'hòu miàn', '停车场在后面。'),
    card('对面', 'Đối diện', 'duì miàn', '餐厅在对面。'),
    card('旁边', 'Bên cạnh', 'páng biān', '图书馆在邮局旁边。'),
    card('地铁', 'Tàu điện ngầm', 'dì tiě', '坐地铁去公司。(Đi tàu điện ngầm đến công ty.)'),
    card('公共汽车', 'Xe buýt', 'gōng gòng qì chē', '坐公共汽车很便宜。'),
    card('火车', 'Xe lửa / tàu hỏa', 'huǒ chē', '坐火车去上海。'),
    card('飞机', 'Máy bay', 'fēi jī', '坐飞机去越南。'),
    card('出租车', 'Taxi', 'chū zū chē', '叫一辆出租车。(Gọi một chiếc taxi.)'),
    card('走', 'Đi bộ', 'zǒu', '走路去学校。(Đi bộ đến trường.)'),
    card('怎么走？', 'Đi như thế nào?', 'zěn me zǒu', '请问，地铁站怎么走？'),
    card('到', 'Đến', 'dào', '到了！(Đến rồi!)'),
    card('路', 'Đường', 'lù', '这条路很长。(Con đường này rất dài.)'),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ██ KOREAN DECKS (6 decks)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Korean — Hangul Vowels & Consonants (TOPIK1) — 20 cards ──────────────

const koHangul: SeedDeck = {
  title: 'Korean — Hangul Vowels & Consonants',
  description: 'Reading the Korean alphabet: 14 consonants and 6 basic vowels.',
  language: 'korean',
  level: 'TOPIK1',
  cards: [
    card('ㄱ', 'g/k — phụ âm', 'g/k', '가 (ga) — đi'),
    card('ㄴ', 'n — phụ âm', 'n', '나 (na) — tôi'),
    card('ㄷ', 'd/t — phụ âm', 'd/t', '다 (da) — tất cả'),
    card('ㄹ', 'r/l — phụ âm', 'r/l', '라면 (ramyeon) — mì gói'),
    card('ㅁ', 'm — phụ âm', 'm', '마음 (maeum) — trái tim'),
    card('ㅂ', 'b/p — phụ âm', 'b/p', '바다 (bada) — biển'),
    card('ㅅ', 's — phụ âm', 's', '사과 (sagwa) — táo'),
    card('ㅇ', 'silent (đầu) / ng (cuối)', 'ŋ', '아이 (ai) — trẻ em'),
    card('ㅈ', 'j — phụ âm', 'j', '자 (ja) — nào'),
    card('ㅊ', 'ch — phụ âm bật hơi', 'tɕʰ', '차 (cha) — trà / xe'),
    card('ㅋ', 'k — phụ âm bật hơi', 'kʰ', '카드 (kadeu) — thẻ'),
    card('ㅌ', 't — phụ âm bật hơi', 'tʰ', '타다 (tada) — đi / leo lên'),
    card('ㅍ', 'p — phụ âm bật hơi', 'pʰ', '피자 (pija) — pizza'),
    card('ㅎ', 'h — phụ âm', 'h', '하늘 (haneul) — bầu trời'),
    card('ㅏ', 'a — nguyên âm', 'a', '아 (a)'),
    card('ㅓ', 'eo — nguyên âm', 'ʌ', '어머니 (eomeoni) — mẹ'),
    card('ㅗ', 'o — nguyên âm', 'o', '오 (o) — năm'),
    card('ㅜ', 'u — nguyên âm', 'u', '우유 (uyu) — sữa'),
    card('ㅡ', 'eu — nguyên âm', 'ɯ', '그 (geu) — cái đó'),
    card('ㅣ', 'i — nguyên âm', 'i', '이 (i) — cái này'),
  ],
};

// ─── 2. Korean — TOPIK 1 Daily Words (TOPIK1) — 20 cards ─────────────────────

const koTopikDaily: SeedDeck = {
  title: 'Korean — TOPIK 1 Daily Words',
  description: 'Twenty everyday words and short phrases for absolute beginners.',
  language: 'korean',
  level: 'TOPIK1',
  cards: [
    card('안녕하세요', 'Xin chào (lịch sự)', 'annyeong haseyo', '안녕하세요, 만나서 반갑습니다.'),
    card('감사합니다', 'Cảm ơn', 'gamsa hamnida', '도와줘서 감사합니다.'),
    card('미안합니다', 'Xin lỗi', 'mianhamnida', '늦어서 미안합니다.'),
    card('네', 'Vâng / Có', 'ne', '네, 알겠습니다.'),
    card('아니요', 'Không', 'aniyo', '아니요, 괜찮습니다.'),
    card('이름', 'Tên', 'ireum', '이름이 뭐예요?'),
    card('나라', 'Đất nước', 'nara', '어느 나라에서 왔어요?'),
    card('학생', 'Học sinh', 'haksaeng', '저는 학생이에요.'),
    card('선생님', 'Giáo viên', 'seonsaengnim', '선생님, 안녕하세요.'),
    card('친구', 'Bạn', 'chingu', '제 친구예요.'),
    card('가족', 'Gia đình', 'gajok', '가족이 몇 명이에요?'),
    card('집', 'Nhà', 'jip', '집에 가요.'),
    card('학교', 'Trường học', 'hakgyo', '학교에서 공부해요.'),
    card('회사', 'Công ty', 'hoesa', '회사에서 일해요.'),
    card('물', 'Nước', 'mul', '물 한 잔 주세요.'),
    card('밥', 'Cơm', 'bap', '밥 먹었어요?'),
    card('책', 'Sách', 'chaek', '이 책 재미있어요.'),
    card('컴퓨터', 'Máy tính', 'keompyuteo', '컴퓨터를 사용해요.'),
    card('전화', 'Điện thoại', 'jeonhwa', '전화 번호가 뭐예요?'),
    card('사랑', 'Tình yêu', 'sarang', '사랑해요!'),
  ],
};

// ─── 3. Korean — Greetings & Polite Forms (A1) — 15 cards ────────────────────

const koGreetings: SeedDeck = {
  title: 'Korean — Greetings & Polite Forms',
  description: 'Set phrases used when meeting, eating and parting in Korean.',
  language: 'korean',
  level: 'A1',
  cards: [
    card('만나서 반갑습니다', 'Rất vui được gặp bạn', 'mannaseo bangapseumnida', '처음 뵙겠습니다. 만나서 반갑습니다.'),
    card('잘 지냈어요?', 'Bạn vẫn khoẻ chứ?', 'jal jinaesseoyo', '오랜만이에요, 잘 지냈어요?'),
    card('잘 부탁드립니다', 'Mong được giúp đỡ', 'jal butakdeurimnida', '앞으로 잘 부탁드립니다.'),
    card('잘 먹겠습니다', 'Tôi sẽ ăn ngon miệng (trước bữa)', 'jal meokgesseumnida'),
    card('잘 먹었습니다', 'Bữa ăn rất ngon (sau bữa)', 'jal meogeosseumnida'),
    card('수고하셨습니다', 'Anh/chị đã vất vả rồi', 'sugohasyeosseumnida', '오늘도 수고하셨습니다.'),
    card('다음에 또 만나요', 'Hẹn gặp lại lần sau', 'daeume tto mannayo'),
    card('안녕히 가세요', 'Tạm biệt (nói với người ra về)', 'annyeonghi gaseyo'),
    card('안녕히 계세요', 'Tạm biệt (nói với người ở lại)', 'annyeonghi gyeseyo'),
    card('실례합니다', 'Xin phép / xin lỗi (làm phiền)', 'sillyehamnida', '실례합니다, 여기 앉아도 될까요?'),
    card('고맙습니다', 'Cảm ơn (lịch sự)', 'gomapseumnida', '정말 고맙습니다.'),
    card('죄송합니다', 'Xin lỗi (trang trọng)', 'joesonghamnida', '늦어서 죄송합니다.'),
    card('괜찮아요', 'Không sao đâu', 'gwaenchanayo', '괜찮아요, 걱정 마세요.'),
    card('어서 오세요', 'Xin mời vào / Chào mừng', 'eoseo oseyo', '어서 오세요, 뭘 드릴까요?'),
    card('잠시만요', 'Xin đợi một chút', 'jamsimanyo', '잠시만요, 곧 올게요.'),
  ],
};

// ─── 4. Korean — Korean Food Vocabulary (TOPIK1) — 15 cards ──────────────────

const koFood: SeedDeck = {
  title: 'Korean — Korean Food Vocabulary',
  description: 'Popular Korean food items and dining expressions.',
  language: 'korean',
  level: 'TOPIK1',
  cards: [
    card('김치', 'Kim chi', 'gimchi', '김치는 한국 음식이에요.'),
    card('비빔밥', 'Cơm trộn', 'bibimbap', '비빔밥 하나 주세요.'),
    card('불고기', 'Thịt bò nướng', 'bulgogi', '불고기가 맛있어요.'),
    card('삼겹살', 'Thịt ba chỉ nướng', 'samgyeopsal', '삼겹살 2인분 주세요.'),
    card('떡볶이', 'Bánh gạo cay', 'tteokbokki', '떡볶이가 매워요.'),
    card('라면', 'Mì gói / mì ramen', 'ramyeon', '라면 먹을래요?'),
    card('김밥', 'Cơm cuộn rong biển', 'gimbap', '김밥 두 줄 주세요.'),
    card('된장찌개', 'Canh tương đậu', 'doenjang jjigae', '된장찌개가 뜨거워요.'),
    card('맛있다', 'Ngon', 'masitda', '이 음식 정말 맛있어요!'),
    card('맵다', 'Cay', 'maepda', '이거 매워요?'),
    card('달다', 'Ngọt', 'dalda', '케이크가 달아요.'),
    card('짜다', 'Mặn', 'jjada', '좀 짜요. (Hơi mặn.)'),
    card('배고프다', 'Đói bụng', 'baegopeda', '배고파요, 밥 먹어요.'),
    card('배부르다', 'No bụng', 'baebureuda', '많이 먹어서 배불러요.'),
    card('메뉴', 'Thực đơn', 'menyu', '메뉴 좀 보여주세요.'),
  ],
};

// ─── 5. Korean — Korean Numbers (TOPIK1) — 20 cards ──────────────────────────

const koNumbers: SeedDeck = {
  title: 'Korean — Korean Numbers',
  description: 'Both native Korean and Sino-Korean number systems.',
  language: 'korean',
  level: 'TOPIK1',
  cards: [
    // Native Korean (하나, 둘, 셋...)
    card('하나', 'Một (thuần Hàn)', 'hana', '사과 하나 주세요. (Cho tôi một quả táo.)'),
    card('둘', 'Hai (thuần Hàn)', 'dul', '커피 둘. (Hai ly cà phê.)'),
    card('셋', 'Ba (thuần Hàn)', 'set', '세 명. (Ba người.)'),
    card('넷', 'Bốn (thuần Hàn)', 'net', '네 시. (Bốn giờ.)'),
    card('다섯', 'Năm (thuần Hàn)', 'daseot', '다섯 개. (Năm cái.)'),
    card('여섯', 'Sáu (thuần Hàn)', 'yeoseot', '여섯 시에 만나요. (Gặp lúc 6 giờ.)'),
    card('일곱', 'Bảy (thuần Hàn)', 'ilgop'),
    card('여덟', 'Tám (thuần Hàn)', 'yeodeol'),
    card('아홉', 'Chín (thuần Hàn)', 'ahop'),
    card('열', 'Mười (thuần Hàn)', 'yeol', '열 개. (Mười cái.)'),
    // Sino-Korean (일, 이, 삼...)
    card('일', 'Một (Hán Hàn)', 'il', '일월. (Tháng 1.)'),
    card('이', 'Hai (Hán Hàn)', 'i', '이월. (Tháng 2.)'),
    card('삼', 'Ba (Hán Hàn)', 'sam', '삼층. (Tầng 3.)'),
    card('사', 'Bốn (Hán Hàn)', 'sa', '사월. (Tháng 4.)'),
    card('오', 'Năm (Hán Hàn)', 'o', '오분. (5 phút.)'),
    card('육', 'Sáu (Hán Hàn)', 'yuk', '육월. (Tháng 6.)'),
    card('칠', 'Bảy (Hán Hàn)', 'chil', '칠월. (Tháng 7.)'),
    card('팔', 'Tám (Hán Hàn)', 'pal', '팔월. (Tháng 8.)'),
    card('구', 'Chín (Hán Hàn)', 'gu', '구십. (90.)'),
    card('십', 'Mười (Hán Hàn)', 'sip', '십이월. (Tháng 12.)'),
  ],
};

// ─── 6. Korean — K-Drama Common Phrases (TOPIK2) — 15 cards ──────────────────

const koDrama: SeedDeck = {
  title: 'Korean — K-Drama Common Phrases',
  description: 'Frequently heard phrases in Korean dramas with context and nuance.',
  language: 'korean',
  level: 'TOPIK2',
  cards: [
    card('사랑해', 'Anh/em yêu em/anh (thân mật)', 'saranghae', '너를 사랑해.'),
    card('보고 싶어', 'Nhớ (ai đó)', 'bogo sipeo', '너무 보고 싶었어.'),
    card('걱정하지 마', 'Đừng lo lắng', 'geokjeonghaji ma', '걱정하지 마, 내가 있잖아.'),
    card('미쳤어?', 'Điên à? / Bị sao vậy?', 'michyeosseo', '야, 미쳤어? (Yah, điên à?)'),
    card('대박', 'Tuyệt vời / Trời ơi', 'daebak', '대박! 정말이야? (Trời ơi! Thật không?)'),
    card('화이팅', 'Cố lên! (Fighting!)', 'hwaiting', '시험 화이팅!'),
    card('진짜?', 'Thật hả? / Thiệt không?', 'jinjja', '진짜? 믿을 수 없어.'),
    card('어떡해', 'Làm sao đây / Biết làm sao', 'eotteokhae', '어떡해, 늦었어! (Làm sao, trễ rồi!)'),
    card('아이고', 'Trời ơi / Ôi (than thở)', 'aigo', '아이고, 힘들다.'),
    card('몰라', 'Không biết / Mặc kệ', 'molla', '나도 몰라. (Tôi cũng không biết.)'),
    card('가지 마', 'Đừng đi', 'gaji ma', '제발 가지 마.'),
    card('잠깐만', 'Chờ một chút', 'jamkkanman', '잠깐만, 같이 가자.'),
    card('맞아', 'Đúng rồi', 'maja', '맞아, 네 말이 맞아. (Đúng, bạn nói đúng.)'),
    card('왜 그래?', 'Sao vậy? / Có chuyện gì?', 'wae geurae', '왜 그래? 무슨 일이야?'),
    card('힘내', 'Cố lên / Mạnh mẽ lên', 'himnae', '힘내, 다 잘 될 거야.'),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ██ VIETNAMESE DECKS (6 decks)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Vietnamese — Survival Phrases for Travelers (A1) — 15 cards ──────────

const viTravel: SeedDeck = {
  title: 'Vietnamese — Survival Phrases for Travelers',
  description: 'Quick phrases that help foreigners get around Vietnam.',
  language: 'vietnamese',
  level: 'A1',
  cards: [
    card('Xin chào', 'Hello / Xin chào', undefined, 'Xin chào, tôi tên là Anna.'),
    card('Cảm ơn', 'Thank you / Cảm ơn', 'kaːm əːn', 'Cảm ơn bạn rất nhiều.'),
    card('Xin lỗi', 'Sorry / Excuse me', 'sin lɔːj', 'Xin lỗi, cho tôi hỏi.'),
    card('Không sao', "It's okay / No problem", undefined, 'Không sao, đừng lo.'),
    card('Bao nhiêu tiền?', 'How much does it cost?', undefined, 'Cái này bao nhiêu tiền?'),
    card('Đắt quá', 'Too expensive', 'ɗăk kwaː', 'Đắt quá! Giảm giá được không?'),
    card('Rẻ hơn được không?', 'Can it be cheaper?', undefined, 'Rẻ hơn được không? Tôi mua hai cái.'),
    card('Tôi không hiểu', "I don't understand", undefined, 'Xin lỗi, tôi không hiểu.'),
    card('Nói chậm lại được không?', 'Could you speak more slowly?', undefined, 'Nói chậm lại được không? Tôi đang học tiếng Việt.'),
    card('Nhà vệ sinh ở đâu?', 'Where is the toilet?', undefined, 'Xin lỗi, nhà vệ sinh ở đâu?'),
    card('Tôi muốn gọi taxi', 'I want to call a taxi', undefined, 'Tôi muốn gọi taxi đi sân bay.'),
    card('Một chai nước, làm ơn', 'One bottle of water, please', undefined, 'Cho tôi một chai nước, làm ơn.'),
    card('Cay không?', 'Is it spicy?', undefined, 'Cái này cay không?'),
    card('Ngon quá!', 'So delicious!', 'ŋɔn kwaː', 'Phở Việt Nam ngon quá!'),
    card('Tạm biệt', 'Goodbye', 'taːm biət', 'Tạm biệt, hẹn gặp lại.'),
  ],
};

// ─── 2. Vietnamese — Family Vocabulary (A1) — 15 cards ────────────────────────

const viFamily: SeedDeck = {
  title: 'Vietnamese — Family Vocabulary',
  description: 'Common kinship terms with the typical pronouns of address.',
  language: 'vietnamese',
  level: 'A1',
  cards: [
    card('Bố / Ba', 'Father / Bố', undefined, 'Bố tôi là bác sĩ.'),
    card('Mẹ / Má', 'Mother / Mẹ', undefined, 'Mẹ tôi nấu ăn rất ngon.'),
    card('Anh', 'Older brother', undefined, 'Anh tôi học đại học.'),
    card('Chị', 'Older sister', undefined, 'Chị ấy rất thông minh.'),
    card('Em', 'Younger sibling', undefined, 'Em tôi mới 5 tuổi.'),
    card('Ông', 'Grandfather / Elderly man', undefined, 'Ông tôi năm nay 80 tuổi.'),
    card('Bà', 'Grandmother / Elderly woman', undefined, 'Bà nấu phở rất ngon.'),
    card('Con', 'Child (son/daughter)', undefined, 'Tôi có hai con.'),
    card('Cháu', 'Grandchild / Niece / Nephew', undefined, 'Cháu chào ông bà.'),
    card('Cô', 'Aunt (father\'s sister) / Ms.', undefined, 'Cô giáo dạy tiếng Anh.'),
    card('Chú', 'Uncle (father\'s younger brother)', undefined, 'Chú ấy rất vui tính.'),
    card('Dì', 'Aunt (mother\'s sister)', undefined, 'Dì tôi sống ở Sài Gòn.'),
    card('Cậu', 'Uncle (mother\'s brother)', undefined, 'Cậu tôi là kỹ sư.'),
    card('Vợ', 'Wife', 'vəː', 'Vợ anh ấy rất xinh.'),
    card('Chồng', 'Husband', 'cɔŋm', 'Chồng chị ấy là bác sĩ.'),
  ],
};

// ─── 3. Vietnamese — Vietnamese Food & Drinks (A1) — 20 cards ────────────────

const viFood: SeedDeck = {
  title: 'Vietnamese — Vietnamese Food & Drinks',
  description: 'Popular Vietnamese dishes and beverages with pronunciation.',
  language: 'vietnamese',
  level: 'A1',
  cards: [
    card('Phở', 'Pho (noodle soup)', 'fəː', 'Phở bò rất ngon.'),
    card('Bún chả', 'Grilled pork with noodles', undefined, 'Bún chả là món đặc sản Hà Nội.'),
    card('Bánh mì', 'Vietnamese baguette sandwich', 'ɓaːjŋ miː', 'Cho tôi một ổ bánh mì.'),
    card('Cơm tấm', 'Broken rice dish', undefined, 'Cơm tấm Sài Gòn rất nổi tiếng.'),
    card('Bún bò Huế', 'Hue spicy beef noodle soup', undefined, 'Bún bò Huế hơi cay.'),
    card('Gỏi cuốn', 'Fresh spring rolls', undefined, 'Gỏi cuốn rất tốt cho sức khỏe.'),
    card('Chả giò', 'Fried spring rolls', undefined, 'Chả giò giòn và ngon.'),
    card('Cà phê sữa đá', 'Iced milk coffee', undefined, 'Tôi thích uống cà phê sữa đá.'),
    card('Trà đá', 'Iced tea', undefined, 'Trà đá miễn phí ở quán.'),
    card('Nước mía', 'Sugarcane juice', undefined, 'Uống nước mía mát lắm.'),
    card('Sinh tố', 'Smoothie / Fruit shake', undefined, 'Cho tôi một ly sinh tố bơ.'),
    card('Bia', 'Beer', undefined, 'Bia Sài Gòn rất nổi tiếng.'),
    card('Chè', 'Sweet dessert soup', undefined, 'Chè thập cẩm rất ngon.'),
    card('Bánh xèo', 'Vietnamese sizzling crepe', undefined, 'Bánh xèo miền Tây rất lớn.'),
    card('Hủ tiếu', 'Southern noodle soup', undefined, 'Hủ tiếu Nam Vang nổi tiếng.'),
    card('Xôi', 'Sticky rice', undefined, 'Sáng tôi ăn xôi.'),
    card('Nước dừa', 'Coconut water', undefined, 'Nước dừa tươi rất mát.'),
    card('Mắm', 'Fish sauce', undefined, 'Nước mắm là gia vị đặc trưng Việt Nam.'),
    card('Rau muống', 'Morning glory / Water spinach', undefined, 'Rau muống xào tỏi rất ngon.'),
    card('Cháo', 'Rice porridge / Congee', undefined, 'Khi ốm, tôi thường ăn cháo.'),
  ],
};

// ─── 4. Vietnamese — Vietnamese Numbers & Money (A1) — 15 cards ──────────────

const viNumbers: SeedDeck = {
  title: 'Vietnamese — Vietnamese Numbers & Money',
  description: 'Numbers, counting, and money vocabulary in Vietnamese.',
  language: 'vietnamese',
  level: 'A1',
  cards: [
    card('Một', 'One / 1', 'mot', 'Một cái bánh. (One cake.)'),
    card('Hai', 'Two / 2', 'haːj', 'Hai ly nước. (Two glasses of water.)'),
    card('Ba', 'Three / 3', 'baː', 'Ba người. (Three people.)'),
    card('Bốn', 'Four / 4', 'ɓon', 'Bốn quyển sách. (Four books.)'),
    card('Năm', 'Five / 5', 'nam', 'Năm phút. (Five minutes.)'),
    card('Sáu', 'Six / 6', 'saːw', 'Sáu giờ sáng. (Six in the morning.)'),
    card('Bảy', 'Seven / 7', 'ɓaj', 'Bảy ngày. (Seven days.)'),
    card('Tám', 'Eight / 8', 'taːm', 'Tám mươi. (Eighty.)'),
    card('Chín', 'Nine / 9', 'cin', 'Chín giờ tối. (Nine at night.)'),
    card('Mười', 'Ten / 10', 'muəj', 'Mười nghìn đồng. (Ten thousand dong.)'),
    card('Nghìn / Ngàn', 'Thousand', undefined, 'Năm nghìn đồng. (Five thousand dong.)'),
    card('Triệu', 'Million', 'ciəw', 'Hai triệu đồng. (Two million dong.)'),
    card('Đồng', 'Dong (Vietnamese currency)', 'ɗoŋm', 'Cái này bao nhiêu đồng?'),
    card('Tiền', 'Money', 'tiən', 'Tôi không có tiền mặt.'),
    card('Trả tiền', 'To pay', undefined, 'Tôi muốn trả tiền. (I want to pay.)'),
  ],
};

// ─── 5. Vietnamese — Vietnamese at the Market (A2) — 15 cards ────────────────

const viMarket: SeedDeck = {
  title: 'Vietnamese — Vietnamese at the Market',
  description: 'Essential phrases for bargaining and shopping at Vietnamese markets.',
  language: 'vietnamese',
  level: 'A2',
  cards: [
    card('Chợ', 'Market', 'cəː', 'Tôi đi chợ mỗi sáng.'),
    card('Mua', 'To buy', 'muə', 'Tôi muốn mua trái cây.'),
    card('Bán', 'To sell', 'ɓaːn', 'Chị bán cái này bao nhiêu?'),
    card('Cân', 'Kilogram / To weigh', 'kən', 'Cho tôi một cân xoài.'),
    card('Trái / Quả', 'Fruit (classifier)', undefined, 'Mấy trái dừa?'),
    card('Tươi', 'Fresh', 'tuəj', 'Cá này tươi không?'),
    card('Giảm giá', 'Discount / Reduce price', undefined, 'Giảm giá cho tôi đi!'),
    card('Mắc quá / Đắt quá', 'Too expensive', undefined, 'Mắc quá, bớt đi chị!'),
    card('Thêm', 'More / Extra', undefined, 'Cho thêm một ít rau.'),
    card('Bớt', 'Reduce / Less', undefined, 'Bớt cho em đi!'),
    card('Thử', 'To try', undefined, 'Tôi có thể thử được không?'),
    card('Gói', 'To wrap / Package', 'ɡɔːj', 'Gói cho tôi hai cái.'),
    card('Túi', 'Bag', 'tuːj', 'Cho tôi thêm một túi.'),
    card('Tiền thối / Tiền thừa', 'Change (money back)', undefined, 'Tiền thối đây ạ.'),
    card('Tính tiền', 'Calculate the bill / Check out', undefined, 'Tính tiền giùm tôi.'),
  ],
};

// ─── 6. Vietnamese — Vietnamese Tones & Pronunciation (A1) — 15 cards ────────

const viTones: SeedDeck = {
  title: 'Vietnamese — Tones & Pronunciation Guide',
  description: 'Understanding the six Vietnamese tones with minimal pair examples.',
  language: 'vietnamese',
  level: 'A1',
  cards: [
    card('Thanh ngang (a)', 'Level tone — mid, flat', 'a˧', 'ma = con ma (ghost)'),
    card('Thanh sắc (á)', 'Rising tone — sharp rise', 'a˧˥', 'má = mẹ (mother)'),
    card('Thanh huyền (à)', 'Falling tone — gentle fall', 'a˧˩', 'mà = nhưng (but)'),
    card('Thanh hỏi (ả)', 'Dipping-rising tone — dip then rise', 'a˧˩˧', 'mả = mộ (grave)'),
    card('Thanh ngã (ã)', 'Broken rising tone — glottalized rise', 'a˧˥ˀ', 'mã = ngựa (horse — Hán Việt)'),
    card('Thanh nặng (ạ)', 'Heavy falling tone — low, abrupt', 'a˧˩ˀ', 'mạ = mạ (rice seedling)'),
    card('ba - bá - bà', 'Three: ba=3, bá=bá tước, bà=bà (grandmother)', undefined, 'Ba bà đi chợ.'),
    card('bàn - bản - bán', 'Bàn=table, bản=version, bán=sell', undefined, 'Bán bàn bản gỗ.'),
    card('Phụ âm đầu: b, c, d, đ', 'Initial consonants: b, c (k), d (z/j), đ (ɗ)', undefined, 'đ phát âm là /ɗ/, d miền Bắc là /z/.'),
    card('Phụ âm đầu: g, h, k, l', 'Initial consonants: g (ɣ), h, k, l', undefined, 'gà = chicken, hà = descent'),
    card('Nguyên âm đơn: a, ă, â', 'Single vowels: a (long), ă (short), â (short central)', undefined, 'tay=hand, tăng=increase, tầng=floor'),
    card('Nguyên âm đơn: e, ê, i', 'Single vowels: e (ɛ), ê (e), i', undefined, 'em=younger, êm=gentle, im=silent'),
    card('Nguyên âm đơn: o, ô, ơ', 'Single vowels: o (ɔ), ô (o), ơ (əː)', undefined, 'con=child, cốn=×, cơn=bout'),
    card('Nguyên âm đôi: ia, ưa, ua', 'Diphthongs: ia, ưa, ua', undefined, 'mía=sugarcane, mưa=rain, mua=buy'),
    card('Phụ âm cuối: -n, -ng, -m, -nh', 'Final consonants: -n, -ng, -m, -nh', undefined, 'bàn=table, bàng=banyan, bảm=×, bành=expand'),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── Additional New Decks ──────────────────────────────────────────────────

const jpAdverbsConjunctions: SeedDeck = {
  title: 'Japanese — Useful Adverbs & Conjunctions',
  description: 'Connect sentences and describe actions naturally using JLPT N4 adverbs and conjunctions.',
  language: 'japanese',
  level: 'N4',
  cards: [
    card('とても', 'Rất / cực kỳ', 'totemo', 'とても寒いです。 (Very cold.)'),
    card('もっと', 'Hơn nữa / thêm nữa', 'motto', 'もっとゆっくり話してください。 (Please speak more slowly.)'),
    card('ゆっくり', 'Chầm chậm / thong thả', 'yukkuri', 'ゆっくり休んでください。 (Please rest slowly/well.)'),
    card('すぐ', 'Ngay lập tức', 'sugu', 'すぐ行きます。 (I will go immediately.)'),
    card('たぶん', 'Có lẽ / có thể', 'tabun', '明日はたぶん雨です。 (Tomorrow will probably rain.)'),
    card('もし', 'Nếu / giả sử', 'moshi', 'もし雨が降ったら、行きません。 (If it rains, I won\'t go.)'),
    card('しかし', 'Nhưng / tuy nhiên', 'shikashi', '彼は親切です。しかし、少しうるさい。 (He is kind. However, a bit noisy.)'),
    card('だから', 'Vì vậy / cho nên', 'dakara', '雨です。だから、出かけません。 (It is raining. Therefore, I won\'t go out.)'),
    card('그리고 (그리고 / soshite)', 'Và / rồi thì', 'soshite', '京都に行きました。そして、写真を撮りました。 (Went to Kyoto. And took photos.)'),
    card('それから', 'Sau đó', 'sorekara', '宿題をします。それから、寝ます。 (I do homework. After that, I sleep.)'),
    card('ときどき', 'Thỉnh thoảng', 'tokidoki', 'ときどき図書館で勉強します。 (Sometimes I study at the library.)'),
    card('ぜんぜん', 'Hoàn toàn không (đi với phủ định)', 'zenzen', '日本語がぜんぜん分かりません。 (I don\'t understand Japanese at all.)'),
    card('ちかく', 'Gần / ở cạnh (近く)', 'chikaku', '駅の近くに住んでいます。 (I live near the station.)'),
    card('はじめて', 'Lần đầu tiên (初めて)', 'hajimete', '日本へ初めて来ました。 (I came to Japan for the first time.)'),
    card('ぜひ', 'Nhất định / rất mong', 'zehi', 'ぜひ遊びに来てください。 (Please definitely come visit.)'),
  ],
};

const zhHsk2Verbs: SeedDeck = {
  title: 'Chinese — Essential HSK 2 Verbs',
  description: 'Core action words required for the HSK 2 level with pinyin and examples.',
  language: 'chinese',
  level: 'HSK2',
  cards: [
    card('帮助', 'Giúp đỡ', 'bāngzhù', '谢谢你帮助我。 (Thank you for helping me.)'),
    card('准备', 'Chuẩn bị', 'zhǔnbèi', '你准备好了吗？ (Are you ready?)'),
    card('开始', 'Bắt đầu', 'kāishǐ', '会议两点开始。 (The meeting starts at 2 o\'clock.)'),
    card('介绍', 'Giới thiệu', 'jièshào', '让我自我介绍一下。 (Let me introduce myself.)'),
    card('唱歌', 'Hát', 'chànggē', '她唱歌唱得很好听。 (She sings very beautifully.)'),
    card('跳舞', 'Nhảy múa', 'tiàowǔ', '他们喜欢跳舞。 (They like to dance.)'),
    card('旅游', 'Du lịch', 'lǚyóu', '我们明年去中国旅游。 (We will travel to China next year.)'),
    card('上班', 'Đi làm', 'shàngbān', '我每天八点半上班。 (I go to work at 8:30 every day.)'),
    card('懂', 'Hiểu / biết', 'dǒng', '我听懂了。 (I understood by listening.)'),
    card('欢迎', 'Hoan nghênh / chào mừng', 'huānyíng', '欢迎你来北京！ (Welcome to Beijing!)'),
    card('回答', 'Trả lời', 'huídá', '请回答我的问题。 (Please answer my question.)'),
    card('告诉', 'Nói cho biết / báo', 'gàosù', '他告诉我一个好消息。 (He told me a piece of good news.)'),
    card('送', 'Tặng / tiễn / đưa', 'sòng', '这是我送给你的礼物。 (This is the gift I give you.)'),
    card('生病', 'Tổn thương / bị bệnh', 'shēngbìng', '他生病了，今天没来上班。 (He is sick, didn\'t come to work today.)'),
    card('跑步', 'Chạy bộ', 'pǎobù', '我喜欢在公园跑步。 (I like running in the park.)'),
  ],
};

const englishTechAI: SeedDeck = {
  title: 'English — Tech & AI Vocabulary',
  description: 'Essential terminology for technology, machine learning, and artificial intelligence in English.',
  language: 'english',
  level: 'B2',
  cards: [
    card('Algorithm', 'Thuật toán', 'ˈæl.ɡə.rɪ.ðəm', 'The recommendation algorithm is very accurate.'),
    card('Artificial Intelligence', 'Trí tuệ nhân tạo', 'ˌɑː.tɪˈfɪʃ.əl ɪnˈtel.ɪ.dʒəns', 'AI is revolutionizing healthcare.'),
    card('Machine Learning', 'Học máy', 'məˈʃiːn ˈlɜː.nɪŋ', 'Machine learning models require huge datasets.'),
    card('Neural Network', 'Mạng nơ-ron', 'ˈnjʊə.rəl ˈnet.wɜːk', 'Deep learning uses artificial neural networks.'),
    card('Dataset', 'Tập dữ liệu', 'ˈdeɪ.tə.set', 'We cleaned the dataset before starting the training.'),
    card('Data Mining', 'Khai phá dữ liệu', 'ˈdeɪ.tə ˈmaɪ.nɪŋ', 'Data mining helps discover hidden patterns.'),
    card('Automation', 'Tự động hóa', 'ˌɔː.təˈmeɪ.ʃən', 'Factory automation increases efficiency.'),
    card('Cloud Computing', 'Điện toán đám mây', 'klaʊd kəmˈpjuː.tɪŋ', 'We store our databases using cloud computing.'),
    card('Cybersecurity', 'An ninh mạng', 'ˈsaɪ.bər.sɪˌkjʊə.rɪ.ti', 'Cybersecurity prevents unauthorized access.'),
    card('Software Developer', 'Nhà phát triển phần mềm', 'ˈsɒft.weər dɪˈvel.ə.pər', 'He works as a senior software developer.'),
    card('User Interface', 'Giao diện người dùng', 'ˈjuː.zər ˈɪn.tə.feɪs', 'The new UI is clean and intuitive.'),
    card('Database Management', 'Quản trị cơ sở dữ liệu', 'ˈdeɪ.tə.beɪs ˈmæn.ɪdʒ.mənt', 'SQL is commonly used in database management.'),
    card('Open Source', 'Mã nguồn mở', 'ˈəʊ.pən sɔːs', 'Linux is a famous open source operating system.'),
    card('Virtual Reality', 'Thực tế ảo', 'ˈvɜː.tʃu.əl riˈæl.ə.ti', 'VR is widely used in gaming and training simulations.'),
    card('Blockchain', 'Chuỗi khối', 'ˈblɒk.tʃeɪn', 'Blockchain secures transaction histories in cryptocurrency.'),
  ],
};

const englishEnvClimate: SeedDeck = {
  title: 'English — Environment & Climate',
  description: 'Vocabulary related to nature, ecological issues, and renewable energy.',
  language: 'english',
  level: 'B1',
  cards: [
    card('Global warming', 'Sự nóng lên toàn cầu', 'ˌɡloʊ.bəl ˈwɔːr.mɪŋ', 'Global warming is causing polar ice caps to melt.'),
    card('Climate change', 'Biến đổi khí hậu', 'ˈklaɪ.mət tʃeɪndʒ', 'Countries must cooperate to fight climate change.'),
    card('Renewable energy', 'Năng lượng tái tạo', 'rɪˈnjuː.ə.bəl ˈen.ər.dʒi', 'Wind and solar power are forms of renewable energy.'),
    card('Solar panel', 'Tấm pin mặt trời', 'ˈsoʊ.lər ˈpæn.əl', 'Installing solar panels can reduce electricity bills.'),
    card('Carbon footprint', 'Dấu chân carbon', 'ˌkɑːr.bən ˈfʊt.prɪnt', 'Using public transport helps lower your carbon footprint.'),
    card('Deforestation', 'Sự phá rừng', 'diːˌfɔːr.əˈsteɪ.ʃən', 'Deforestation threatens many endangered species.'),
    card('Biodiversity', 'Đa dạng sinh học', 'ˌbaɪ.oʊ.daɪˈvɜːr.sə.ti', 'Rainforests are areas of rich biodiversity.'),
    card('Sustainability', 'Sự bền vững', 'səˌsteɪ.nəˈbɪl.ə.ti', 'The project focuses on environmental sustainability.'),
    card('Conservation', 'Sự bảo tồn', 'ˌkɑːn.səˈveɪ.ʃən', 'Wildlife conservation is essential for ecosystem balance.'),
    card('Ecosystem', 'Hệ sinh thái', 'ˈiː.koʊˌsɪs.təm', 'Pollution can damage the local marine ecosystem.'),
    card('Greenhouse gas', 'Khí nhà kính', 'ˈɡriːn.haʊs ɡæs', 'Carbon dioxide is a major greenhouse gas.'),
    card('Recycling', 'Sự tái chế', 'ˌriːˈsaɪ.klɪŋ', 'Recycling plastic bottles reduces waste in landfills.'),
    card('Fossil fuels', 'Nhiên liệu hóa thạch', 'ˈfɑː.səl ˈfjuː.əlz', 'Burning fossil fuels releases harmful emissions.'),
    card('Pollution', 'Sự ô nhiễm', 'pəˈluː.ʃən', 'Air pollution is a serious problem in big cities.'),
    card('Organic', 'Hữu cơ', 'ɔːrˈɡæn.ɪk', 'She prefers buying organic vegetables.'),
  ],
};

const englishSocialMedia: SeedDeck = {
  title: 'English — Social Media & Communication',
  description: 'Modern terminology for online networking, platforms, and digital communication.',
  language: 'english',
  level: 'B2',
  cards: [
    card('Influencer', 'Người có ảnh hưởng', 'ˈɪn.flu.ən.sər', 'Brands often collaborate with social media influencers.'),
    card('Algorithm', 'Thuật toán', 'ˈæl.ɡə.rɪ.ðəm', 'The algorithm determines which posts appear on your feed.'),
    card('Viral', 'Lan truyền nhanh', 'ˈvaɪ.rəl', 'The cat video went viral overnight.'),
    card('Engagement', 'Sự tương tác', 'ɪnˈɡeɪdʒ.mənt', 'High engagement rates indicate popular content.'),
    card('Subscriber', 'Người đăng ký', 'səbˈskraɪ.bər', 'The YouTube channel has over one million subscribers.'),
    card('Content creator', 'Nhà sáng tạo nội dung', 'ˈkɑːn.tent kriˈeɪ.tər', 'He works full-time as a digital content creator.'),
    card('Direct message', 'Tin nhắn trực tiếp', 'daɪˈrekt ˈmes.ɪdʒ', 'Send us a direct message for inquiries.'),
    card('Hashtag', 'Thẻ hashtag', 'ˈhæʃ.tæɡ', 'Use the hashtag to join the online conversation.'),
    card('Trending', 'Đang thịnh hành', 'ˈtrend.ɪŋ', 'The topic is currently trending on Twitter.'),
    card('Platform', 'Nền tảng', 'ˈplæt.fɔːrm', 'Instagram is a popular platform for sharing photos.'),
    card('Feed', 'Bảng tin', 'fiːd', 'I check my news feed every morning.'),
    card('Notifications', 'Thông báo', 'ˌnoʊ.t̬ə.fəˈkeɪ.ʃənz', 'Turn off notifications to focus on your work.'),
    card('Privacy settings', 'Cài đặt riêng tư', 'ˈpraɪ.və.si ˈset.ɪŋz', 'Check your privacy settings to protect your data.'),
    card('Cyberbullying', 'Bắt nạt qua mạng', 'ˈsaɪ.bər.bʊl.i.ɪŋ', 'Schools are taking steps to prevent cyberbullying.'),
    card('Clickbait', 'Mồi nhấp chuột', 'ˈklɪk.beɪt', 'The headline was just clickbait to get views.'),
  ],
};

const jpShoppingClothes: SeedDeck = {
  title: 'Japanese — Shopping & Clothes',
  description: 'Vocabulary for buying items, choosing sizes, and clothing names in Japan.',
  language: 'japanese',
  level: 'N5',
  cards: [
    card('買う (かう)', 'Mua', 'kau', 'デパートで服を買います。 (I buy clothes at the department store.)'),
    card('服 (ふく)', 'Quần áo', 'fuku', '新しい服が欲しいです。 (I want new clothes.)'),
    card('店 (みせ)', 'Cửa hàng', 'mise', 'あの店はいつも人が多いです。 (That store is always crowded.)'),
    card('靴 (くつ)', 'Giày', 'kutsu', 'この靴は歩きやすいです。 (These shoes are easy to walk in.)'),
    card('安い (やすい)', 'Rẻ', 'yasui', 'このスーパーの野菜は安いです。 (The vegetables at this supermarket are cheap.)'),
    card('高い (たかい)', 'Đắt / Cao', 'takai', 'このカバンは高すぎます。 (This bag is too expensive.)'),
    card('試着 (しちゃく)', 'Mặc thử', 'shichaku', 'これを試着してもいいですか？ (Can I try this on?)'),
    card('サイズ (さいず)', 'Kích cỡ', 'saizu', 'Mサイズはありますか？ (Do you have size M?)'),
    card('お金 (おかね)', 'Tiền', 'okane', 'お金を払います。 (I pay the money.)'),
    card('クレジットカード', 'Thẻ tín dụng', 'kurejitto kādo', 'クレジットカードは使えますか？ (Can I use a credit card?)'),
    card('袋 (ふくろ)', 'Túi / Bao', 'fukuro', '袋に入れますか？ (Shall I put it in a bag?)'),
    card('レシート', 'Hóa đơn / Biên lai', 'reshīto', 'レシートをお願いします。 (Receipt, please.)'),
    card('探す (さがす)', 'Tìm kiếm', 'sagasu', 'お土産を探しています。 (I am looking for souvenirs.)'),
    card('売り場 (うりば)', 'Quầy bán hàng', 'uriba', '靴の売り場はどこですか？ (Where is the shoe department?)'),
    card('セール', 'Giảm giá', 'sēru', '明日からセールが始まります。 (The sale starts tomorrow.)'),
  ],
};

const jpWeatherSeasons: SeedDeck = {
  title: 'Japanese — Weather & Seasons',
  description: 'Vocabulary related to seasons, weather conditions, and natural phenomena in Japanese.',
  language: 'japanese',
  level: 'N4',
  cards: [
    card('季節 (きせつ)', 'Mùa', 'kisetsu', '日本には四つの季節があります。 (Japan has four seasons.)'),
    card('台風 (たいふう)', 'Bão', 'taifū', '台風で電車が止まりました。 (The train stopped due to the typhoon.)'),
    card('湿度 (しつど)', 'Độ ẩm', 'shitsudo', '夏は湿度が高いです。 (Humidity is high in summer.)'),
    card('気温 (きおん)', 'Nhiệt độ không khí', 'kion', '今日の気温は三十度です。 (Today\'s temperature is 30 degrees.)'),
    card('梅雨 (つゆ)', 'Mùa mưa', 'tsuyu', '六月は梅雨の季節です。 (June is the rainy season.)'),
    card('桜 (さくら)', 'Hoa anh đào', 'sakura', '春に桜が咲きます。 (Cherry blossoms bloom in spring.)'),
    card('紅葉 (もみじ)', 'Lá đỏ', 'momiji', '秋は紅葉が美しいです。 (Autumn leaves are beautiful in autumn.)'),
    card('雪 (ゆき)', 'Tuyết', 'yuki', '北海道では雪が降っています。 (It is snowing in Hokkaido.)'),
    card('晴れる (はれる)', 'Nắng / Quang đãng', 'hareru', '午後は晴れるでしょう。 (It will probably clear up in the afternoon.)'),
    card('曇り (くもり)', 'Trời mây', 'kumori', '今日は曇りです。 (Today is cloudy.)'),
    card('降る (ふる)', 'Rơi (mưa, tuyết)', 'furu', '雨が激しく降っています。 (It is raining heavily.)'),
    card('地震 (じしん)', 'Động đất', 'jishin', '昨日、小さな地震がありました。 (There was a small earthquake yesterday.)'),
    card('津波 (つなみ)', 'Sóng thần', 'tsunami', '地震の後、津波の心配があります。 (After an earthquake, there is concern about tsunamis.)'),
    card('予報 (よほう)', 'Dự báo', 'yohō', '天気予報を見ます。 (I look at the weather forecast.)'),
    card('蒸し暑い (むしあつい)', 'Oi bức / nóng ẩm', 'mushiatsui', '日本の夏は蒸し暑いです。 (Japanese summer is hot and humid.)'),
  ],
};

const zhHsk3Verbs: SeedDeck = {
  title: 'Chinese — HSK 3 Common Verbs',
  description: 'Essential verbs required for the HSK 3 proficiency level with pinyin and examples.',
  language: 'chinese',
  level: 'HSK3',
  cards: [
    card('同意', 'Đồng ý', 'tóngyì', '我同意你的看法。 (I agree with your view.)'),
    card('借', 'Mượn / Vay', 'jiè', '我想借这本书。 (I want to borrow this book.)'),
    card('决定', 'Quyết định', 'juédìng', '我们决定明天出发。 (We decided to set off tomorrow.)'),
    card('完成', 'Hoàn thành', 'wánchéng', '我已经完成了作业。 (I have already completed my homework.)'),
    card('选择', 'Chọn lựa', 'xuǎnzé', '请选择正确的答案。 (Please choose the correct answer.)'),
    card('要求', 'Yêu cầu', 'yāoqiú', '老师对我们的要求很高。 (The teacher has high requirements for us.)'),
    card('解决', 'Giải quyết', 'jiějué', '这个问题很难解决。 (This problem is hard to solve.)'),
    card('认为', 'Cho rằng', 'rènwéi', '我认为他是对的。 (I think he is right.)'),
    card('发现', 'Phát hiện / Tìm ra', 'fāxiàn', '我发现他今天有点儿累。 (I noticed he is a bit tired today.)'),
    card('相信', 'Tin tưởng', 'xiāngxìn', '我相信你会成功的。 (I believe you will succeed.)'),
    card('出现', 'Xuất hiện', 'chūxiàn', '天空中出现了彩虹。 (A rainbow appeared in the sky.)'),
    card('提高', 'Nâng cao / Cải thiện', 'tígāo', '我想提高我的汉语水平。 (I want to improve my Chinese level.)'),
    card('照顾', 'Chăm sóc', 'zhàogù', '谢谢你照顾我。 (Thank you for taking care of me.)'),
    card('明白', 'Hiểu', 'míngbai', '你明白我的意思吗？ (Do you understand what I mean?)'),
    card('影响', 'Ảnh hưởng', 'yǐngxiǎng', '看电视会影响学习。 (Watching TV will affect studying.)'),
  ],
};

const zhFamilyHobbies: SeedDeck = {
  title: 'Chinese — Family & Hobbies',
  description: 'Common terms for family relations and recreational activities at HSK 2 level.',
  language: 'chinese',
  level: 'HSK2',
  cards: [
    card('丈夫', 'Chồng', 'zhàngfu', '她的丈夫是一位医生。 (Her husband is a doctor.)'),
    card('妻子', 'Vợ', 'qīzi', '他的妻子很漂亮。 (His wife is very beautiful.)'),
    card('哥哥', 'Anh trai', 'gēge', '我哥哥比我大两岁。 (My older brother is two years older than me.)'),
    card('姐姐', 'Chị gái', 'jiějie', '我姐姐在银行工作。 (My older sister works in a bank.)'),
    card('弟弟', 'Em trai', 'dìdi', '我弟弟最喜欢踢足球。 (My younger brother likes playing soccer best.)'),
    card('妹妹', 'Em gái', 'mèimei', '我妹妹正在写作业。 (My younger sister is doing homework.)'),
    card('唱歌', 'Hát', 'chànggē', '他唱歌唱得非常好。 (He sings very well.)'),
    card('跳舞', 'Nhảy / Khiêu vũ', 'tiàowǔ', '她们在跳舞呢。 (They are dancing.)'),
    card('运动', 'Vận động / Thể thao', 'yùndòng', '多运动对身体好。 (More exercise is good for health.)'),
    card('跑步', 'Chạy bộ', 'pǎobù', '我每天早上跑步。 (I run every morning.)'),
    card('旅游', 'Du lịch', 'lǚyóu', '我们去北京旅游了。 (We went traveling to Beijing.)'),
    card('玩', 'Chơi', 'wán', '孩子们在公园里玩。 (The children are playing in the park.)'),
    card('爱好', 'Sở thích', 'àihào', '你的爱好是什么？ (What is your hobby?)'),
    card('电脑', 'Máy tính', 'diànnǎo', '他在电脑上打游戏。 (He is playing games on the computer.)'),
    card('踢足球', 'Đá bóng', 'tī zúqiú', '我们星期六踢足球。 (We play soccer on Saturday.)'),
  ],
};

const koKpopEntert: SeedDeck = {
  title: 'Korean — K-Pop & Entertainment',
  description: 'Vocabulary commonly heard in Korean music, TV shows, and entertainment culture.',
  language: 'korean',
  level: 'TOPIK1',
  cards: [
    card('노래', 'Bài hát', 'norae', '이 노래가 정말 좋아요. (I really like this song.)'),
    card('가수', 'Ca sĩ', 'gasu', '제가 좋아하는 가수는 BTS예요. (My favorite singer is BTS.)'),
    card('드라마', 'Phim truyền hình', 'deurama', '한국 드라마를 자주 봐요. (I watch Korean dramas often.)'),
    card('영화', 'Phim điện ảnh', 'yeonghwa', '어제 친구와 영화를 봤어요. (Yesterday I watched a movie with my friend.)'),
    card('음악', 'Âm nhạc', 'eumak', '음악을 듣는 것을 좋아해요. (I like listening to music.)'),
    card('춤', 'Điệu nhảy', 'chum', '춤을 잘 추는 사람이 멋있어요. (People who dance well are cool.)'),
    card('배우', 'Diễn viên', 'baeu', '이 드라마의 남자 배우가 누구예요? (Who is the male actor of this drama?)'),
    card('예능', 'Chương trình thực tế / giải trí', 'yeneung', '예능 프로그램을 보고 많이 웃었어요. (I laughed a lot watching the variety show.)'),
    card('공연', 'Buổi biểu diễn', 'gongyeon', '다음 달에 콘서트 공연이 있어요. (There is a concert performance next month.)'),
    card('팬', 'Người hâm mộ', 'paen', '저는 그 가수의 오랜 팬이에요. (I have been a fan of that singer for a long time.)'),
    card('스타', 'Ngôi sao / người nổi tiếng', 'seuta', '그는 세계적인 스타가 되었습니다. (He became a global star.)'),
    card('아이돌', 'Thần tượng (idol)', 'aidol', '한국에는 아이돌 그룹이 아주 많아요. (There are very many idol groups in Korea.)'),
    card('방송', 'Phát sóng / truyền hình', 'bangsong', '지금 라이브 방송 중이에요. (It is broadcasting live right now.)'),
    card('대중문화', 'Văn hóa đại chúng', 'daejung munhwa', '한류 덕분에 한국 대중문화가 유명해졌어요. (Korean popular culture became famous thanks to Hallyu.)'),
    card('응원', 'Cổ vũ / ủng hộ', 'eungwon', '우리 팀을 같이 응원해요! (Let\'s cheer for our team together!)'),
  ],
};


// ██ CATALOGUE EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export const DECK_CATALOG: SeedDeck[] = [
  // ── English (14 decks) ──
  englishGreetings,
  englishNumbers,
  englishTravel,
  englishBusiness,
  englishFood,
  englishHealth,
  englishWeather,
  englishColors,
  englishEmotions,
  englishTech,
  englishAcademic,
  englishIdioms,
  englishMedical,
  englishLegal,
  englishTechAI,
  englishEnvClimate,
  englishSocialMedia,
  // ── Japanese (8 decks) ──
  jpHiragana,
  jpN5Vocab,
  jpN5Verbs,
  jpDailyPhrases,
  jpKatakana,
  jpN4Adjectives,
  jpCounters,
  jpRestaurant,
  jpAdverbsConjunctions,
  jpShoppingClothes,
  jpWeatherSeasons,
  // ── Chinese (8 decks) ──
  zhPinyin,
  zhHsk1Vocab,
  zhHsk2Words,
  zhNumbersTime,
  zhHsk3,
  zhMeasureWords,
  zhFood,
  zhDirections,
  zhHsk2Verbs,
  zhHsk3Verbs,
  zhFamilyHobbies,
  // ── Korean (6 decks) ──
  koHangul,
  koTopikDaily,
  koGreetings,
  koFood,
  koNumbers,
  koDrama,
  koKpopEntert,
  // ── Vietnamese (6 decks) ──
  viTravel,
  viFamily,
  viFood,
  viNumbers,
  viMarket,
  viTones,
];


