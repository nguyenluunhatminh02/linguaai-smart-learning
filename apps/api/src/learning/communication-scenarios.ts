interface CommunicationQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

interface CommunicationScenario {
  slug: string;
  level: 'A1' | 'A2';
  title: string;
  objective: string;
  estimatedMinutes: number;
  dialogue: { speaker: string; text: string }[];
  questions: CommunicationQuestion[];
  response: { prompt: string; hint: string; example: string };
  phrase: { text: string; meaning: string; context: string };
}

export const COMMUNICATION_SCENARIOS: readonly CommunicationScenario[] = [
  {
    slug: 'greetings',
    level: 'A1',
    title: 'Chào hỏi và làm quen',
    objective: 'Tôi có thể chào và giới thiệu tên khi gặp một người mới.',
    estimatedMinutes: 5,
    dialogue: [
      { speaker: 'Maya', text: 'Hi, I’m Maya. What’s your name?' },
      { speaker: 'Ben', text: 'I’m Ben. Nice to meet you!' },
      { speaker: 'Maya', text: 'Nice to meet you, too.' },
    ],
    questions: [
      {
        question: 'Maya muốn biết điều gì?',
        options: ['Ben sống ở đâu', 'Ben tên gì', 'Ben bao nhiêu tuổi'],
        correctAnswer: 1,
        explanation: '“What’s your name?” nghĩa là “Bạn tên gì?”.',
      },
    ],
    response: {
      prompt:
        'Maya vừa hỏi tên bạn. Hãy nói tên của bạn và cho biết bạn rất vui được làm quen.',
      hint: 'Dùng “I’m …” để giới thiệu tên. Kết thúc bằng một câu chào lịch sự.',
      example: 'I’m Linh. Nice to meet you!',
    },
    phrase: {
      text: 'Nice to meet you!',
      meaning: 'Rất vui được làm quen với bạn!',
      context: 'I’m Linh. Nice to meet you!',
    },
  },
  {
    slug: 'order-food',
    level: 'A1',
    title: 'Gọi món ở quán',
    objective: 'Tôi có thể gọi một món và nói mình muốn mang đi.',
    estimatedMinutes: 5,
    dialogue: [
      { speaker: 'Nhân viên', text: 'Hi! What would you like?' },
      { speaker: 'Khách', text: 'A cheese sandwich, please.' },
      { speaker: 'Nhân viên', text: 'For here or to go?' },
      { speaker: 'Khách', text: 'To go, please.' },
    ],
    questions: [
      {
        question: 'Khách muốn dùng món ở đâu?',
        options: ['Tại quán', 'Mang đi', 'Khách chưa quyết định'],
        correctAnswer: 1,
        explanation: '“To go” nghĩa là “mang đi”. “For here” là dùng tại quán.',
      },
    ],
    response: {
      prompt:
        'Nhân viên hỏi bạn muốn dùng tại quán hay mang đi. Bạn muốn mang đi. Hãy trả lời lịch sự.',
      hint: 'Cụm từ dùng để xin mang đi bắt đầu bằng “To …”. Thêm “please”.',
      example: 'To go, please.',
    },
    phrase: {
      text: 'To go, please.',
      meaning: 'Cho mình mang đi nhé.',
      context: 'For here or to go? — To go, please.',
    },
  },
  {
    slug: 'shopping',
    level: 'A1',
    title: 'Mua hàng và hỏi giá',
    objective: 'Tôi có thể hỏi giá một món đồ và hiểu câu trả lời.',
    estimatedMinutes: 5,
    dialogue: [
      { speaker: 'Khách', text: 'Excuse me, how much is this notebook?' },
      { speaker: 'Nhân viên', text: 'It’s three dollars.' },
      { speaker: 'Khách', text: 'Great. I’ll take it, please.' },
    ],
    questions: [
      {
        question: 'Cuốn sổ giá bao nhiêu?',
        options: ['3 đô la', '5 đô la', '13 đô la'],
        correctAnswer: 0,
        explanation: '“Three dollars” nghĩa là “ba đô la”.',
      },
    ],
    response: {
      prompt:
        'Bạn nhìn thấy một chiếc bút và muốn biết giá. Hãy hỏi nhân viên bằng tiếng Anh.',
      hint: 'Bắt đầu với “How much is …?”. “Bút” ở đây là “pen”.',
      example: 'Excuse me, how much is this pen?',
    },
    phrase: {
      text: 'How much is this?',
      meaning: 'Cái này giá bao nhiêu?',
      context: 'Excuse me, how much is this notebook?',
    },
  },
  {
    slug: 'directions',
    level: 'A2',
    title: 'Hỏi và chỉ đường',
    objective: 'Tôi có thể nghe chỉ đường ngắn và hỏi lại vị trí cần đến.',
    estimatedMinutes: 5,
    dialogue: [
      {
        speaker: 'Du khách',
        text: 'Excuse me, how do I get to the train station?',
      },
      {
        speaker: 'Người đi đường',
        text: 'Go straight along this street. Turn left at the bank.',
      },
      { speaker: 'Du khách', text: 'Is the station far from the bank?' },
      { speaker: 'Người đi đường', text: 'No, it’s right next to the bank.' },
    ],
    questions: [
      {
        question: 'Sau khi đi thẳng, du khách cần làm gì?',
        options: [
          'Rẽ phải ở ngân hàng',
          'Đi qua ga tàu',
          'Rẽ trái ở ngân hàng',
        ],
        correctAnswer: 2,
        explanation: '“Turn left at the bank” là rẽ trái ở chỗ ngân hàng.',
      },
    ],
    response: {
      prompt:
        'Bạn đang tìm thư viện. Hãy lịch sự hỏi một người đi đường xem bạn có thể tới đó bằng cách nào.',
      hint: 'Hỏi đường bằng “How do I get to …?”. “Thư viện” là “the library”.',
      example: 'Excuse me, how do I get to the library?',
    },
    phrase: {
      text: 'How do I get to …?',
      meaning: 'Tôi đi đến … bằng cách nào?',
      context: 'Excuse me, how do I get to the train station?',
    },
  },
  {
    slug: 'make-plans',
    level: 'A2',
    title: 'Hẹn gặp bạn',
    objective: 'Tôi có thể đề xuất thời gian và địa điểm gặp mặt.',
    estimatedMinutes: 5,
    dialogue: [
      { speaker: 'Nora', text: 'Are you free on Saturday afternoon?' },
      { speaker: 'Kai', text: 'Yes, I am. What time works for you?' },
      {
        speaker: 'Nora',
        text: 'How about meeting at three outside the cinema?',
      },
      { speaker: 'Kai', text: 'Three works for me. See you there!' },
    ],
    questions: [
      {
        question: 'Nora và Kai sẽ gặp ở đâu?',
        options: [
          'Ở bên ngoài rạp chiếu phim',
          'Ở trong rạp chiếu phim',
          'Ở quán cà phê lúc ba giờ',
        ],
        correctAnswer: 0,
        explanation: '“Outside the cinema” là “ở bên ngoài rạp chiếu phim”.',
      },
    ],
    response: {
      prompt: 'Hãy đề xuất gặp bạn của mình lúc 4 giờ ở thư viện.',
      hint: 'Dùng “How about meeting …?” và nói rõ giờ, địa điểm.',
      example: 'How about meeting at four at the library?',
    },
    phrase: {
      text: 'What time works for you?',
      meaning: 'Mấy giờ thì tiện cho bạn?',
      context: 'Are you free on Saturday? What time works for you?',
    },
  },
  {
    slug: 'reschedule',
    level: 'A2',
    title: 'Đổi lịch hẹn',
    objective: 'Tôi có thể báo mình bận và đề xuất một giờ hẹn khác.',
    estimatedMinutes: 5,
    dialogue: [
      {
        speaker: 'Lee',
        text: 'Sorry, I can’t make it at two. Could we meet later?',
      },
      { speaker: 'Alex', text: 'Of course. How about half past four?' },
      { speaker: 'Lee', text: 'That works for me. See you at half past four.' },
    ],
    questions: [
      {
        question: 'Giờ gặp mới là mấy giờ?',
        options: ['2 giờ', '4 giờ', '4 giờ 30'],
        correctAnswer: 2,
        explanation: '“Half past four” là “bốn giờ rưỡi”.',
      },
    ],
    response: {
      prompt:
        'Bạn không đến được lúc 3 giờ. Hãy báo cho bạn mình và đề xuất gặp lúc 5 giờ.',
      hint: 'Mở đầu với “Sorry, I can’t make it at …”. Đề xuất giờ mới với “Could we meet at …?”.',
      example: 'Sorry, I can’t make it at three. Could we meet at five?',
    },
    phrase: {
      text: 'Could we meet later?',
      meaning: 'Chúng ta gặp muộn hơn được không?',
      context: 'Sorry, I can’t make it at two. Could we meet later?',
    },
  },
];
