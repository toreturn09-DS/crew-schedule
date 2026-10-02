// IATA 코드 → [한글 공항명, 짧은 이름(달력 칸 표시용), IANA 시간대]
const AIRPORTS = {
  // ── 대한민국
  ICN: ['인천국제공항', '인천', 'Asia/Seoul'],
  GMP: ['김포국제공항', '김포', 'Asia/Seoul'],
  PUS: ['김해국제공항', '부산', 'Asia/Seoul'],
  CJU: ['제주국제공항', '제주', 'Asia/Seoul'],
  TAE: ['대구국제공항', '대구', 'Asia/Seoul'],
  CJJ: ['청주국제공항', '청주', 'Asia/Seoul'],
  KWJ: ['광주공항', '광주', 'Asia/Seoul'],
  MWX: ['무안국제공항', '무안', 'Asia/Seoul'],
  RSU: ['여수공항', '여수', 'Asia/Seoul'],
  USN: ['울산공항', '울산', 'Asia/Seoul'],
  KPO: ['포항경주공항', '포항', 'Asia/Seoul'],
  YNY: ['양양국제공항', '양양', 'Asia/Seoul'],
  HIN: ['사천공항', '사천', 'Asia/Seoul'],
  KUV: ['군산공항', '군산', 'Asia/Seoul'],
  WJU: ['원주공항', '원주', 'Asia/Seoul'],

  // ── 일본
  NRT: ['도쿄 나리타국제공항', '나리타', 'Asia/Tokyo'],
  HND: ['도쿄 하네다공항', '하네다', 'Asia/Tokyo'],
  KIX: ['오사카 간사이국제공항', '간사이', 'Asia/Tokyo'],
  ITM: ['오사카 이타미공항', '이타미', 'Asia/Tokyo'],
  UKB: ['고베공항', '고베', 'Asia/Tokyo'],
  NGO: ['나고야 주부국제공항', '나고야', 'Asia/Tokyo'],
  FUK: ['후쿠오카공항', '후쿠오카', 'Asia/Tokyo'],
  CTS: ['삿포로 신치토세공항', '삿포로', 'Asia/Tokyo'],
  OKA: ['오키나와 나하공항', '오키나와', 'Asia/Tokyo'],
  KOJ: ['가고시마공항', '가고시마', 'Asia/Tokyo'],
  KMJ: ['구마모토공항', '구마모토', 'Asia/Tokyo'],
  KMI: ['미야자키공항', '미야자키', 'Asia/Tokyo'],
  OIT: ['오이타공항', '오이타', 'Asia/Tokyo'],
  KKJ: ['기타큐슈공항', '기타큐슈', 'Asia/Tokyo'],
  NGS: ['나가사키공항', '나가사키', 'Asia/Tokyo'],
  HSG: ['사가공항', '사가', 'Asia/Tokyo'],
  MYJ: ['마쓰야마공항', '마쓰야마', 'Asia/Tokyo'],
  TAK: ['다카마쓰공항', '다카마쓰', 'Asia/Tokyo'],
  HIJ: ['히로시마공항', '히로시마', 'Asia/Tokyo'],
  OKJ: ['오카야마공항', '오카야마', 'Asia/Tokyo'],
  YGJ: ['요나고공항', '요나고', 'Asia/Tokyo'],
  KMQ: ['고마쓰공항', '고마쓰', 'Asia/Tokyo'],
  TOY: ['도야마공항', '도야마', 'Asia/Tokyo'],
  KIJ: ['니가타공항', '니가타', 'Asia/Tokyo'],
  SDJ: ['센다이공항', '센다이', 'Asia/Tokyo'],
  AOJ: ['아오모리공항', '아오모리', 'Asia/Tokyo'],
  AKJ: ['아사히카와공항', '아사히카와', 'Asia/Tokyo'],
  HKD: ['하코다테공항', '하코다테', 'Asia/Tokyo'],
  FSZ: ['시즈오카공항', '시즈오카', 'Asia/Tokyo'],
  IBR: ['이바라키공항', '이바라키', 'Asia/Tokyo'],
  ISG: ['이시가키공항', '이시가키', 'Asia/Tokyo'],

  // ── 중국
  PEK: ['베이징 서우두국제공항', '베이징', 'Asia/Shanghai'],
  PKX: ['베이징 다싱국제공항', '다싱', 'Asia/Shanghai'],
  PVG: ['상하이 푸둥국제공항', '푸둥', 'Asia/Shanghai'],
  SHA: ['상하이 훙차오국제공항', '훙차오', 'Asia/Shanghai'],
  CAN: ['광저우 바이윈국제공항', '광저우', 'Asia/Shanghai'],
  SZX: ['선전 바오안국제공항', '선전', 'Asia/Shanghai'],
  TAO: ['칭다오 자오둥국제공항', '칭다오', 'Asia/Shanghai'],
  DLC: ['다롄 저우수이쯔국제공항', '다롄', 'Asia/Shanghai'],
  SHE: ['선양 타오셴국제공항', '선양', 'Asia/Shanghai'],
  YNJ: ['옌지 차오양촨국제공항', '옌지', 'Asia/Shanghai'],
  TSN: ['톈진 빈하이국제공항', '톈진', 'Asia/Shanghai'],
  WEH: ['웨이하이 다수이보국제공항', '웨이하이', 'Asia/Shanghai'],
  YNT: ['옌타이 펑라이국제공항', '옌타이', 'Asia/Shanghai'],
  HGH: ['항저우 샤오산국제공항', '항저우', 'Asia/Shanghai'],
  NKG: ['난징 루커우국제공항', '난징', 'Asia/Shanghai'],
  XMN: ['샤먼 가오치국제공항', '샤먼', 'Asia/Shanghai'],
  CTU: ['청두 솽류국제공항', '청두', 'Asia/Shanghai'],
  TFU: ['청두 톈푸국제공항', '청두톈푸', 'Asia/Shanghai'],
  CKG: ['충칭 장베이국제공항', '충칭', 'Asia/Shanghai'],
  XIY: ['시안 셴양국제공항', '시안', 'Asia/Shanghai'],
  KMG: ['쿤밍 창수이국제공항', '쿤밍', 'Asia/Shanghai'],
  WUH: ['우한 톈허국제공항', '우한', 'Asia/Shanghai'],
  CGO: ['정저우 신정국제공항', '정저우', 'Asia/Shanghai'],
  HRB: ['하얼빈 타이핑국제공항', '하얼빈', 'Asia/Shanghai'],
  CGQ: ['창춘 룽자국제공항', '창춘', 'Asia/Shanghai'],
  MDG: ['무단장 하이랑국제공항', '무단장', 'Asia/Shanghai'],
  SYX: ['싼야 펑황국제공항', '싼야', 'Asia/Shanghai'],
  HAK: ['하이커우 메이란국제공항', '하이커우', 'Asia/Shanghai'],
  CSX: ['창사 황화국제공항', '창사', 'Asia/Shanghai'],
  TNA: ['지난 야오창국제공항', '지난', 'Asia/Shanghai'],
  KWL: ['구이린 량장국제공항', '구이린', 'Asia/Shanghai'],
  ZUH: ['주하이 진완공항', '주하이', 'Asia/Shanghai'],
  HKG: ['홍콩국제공항', '홍콩', 'Asia/Hong_Kong'],
  MFM: ['마카오국제공항', '마카오', 'Asia/Macau'],

  // ── 대만 · 몽골
  TPE: ['타이베이 타오위안국제공항', '타이베이', 'Asia/Taipei'],
  TSA: ['타이베이 쑹산공항', '쑹산', 'Asia/Taipei'],
  KHH: ['가오슝국제공항', '가오슝', 'Asia/Taipei'],
  RMQ: ['타이중국제공항', '타이중', 'Asia/Taipei'],
  UBN: ['울란바토르 칭기스칸국제공항', '울란바토르', 'Asia/Ulaanbaatar'],

  // ── 동남아시아
  HAN: ['하노이 노이바이국제공항', '하노이', 'Asia/Ho_Chi_Minh'],
  SGN: ['호찌민 떤선녓국제공항', '호찌민', 'Asia/Ho_Chi_Minh'],
  DAD: ['다낭국제공항', '다낭', 'Asia/Ho_Chi_Minh'],
  CXR: ['나트랑 깜라인국제공항', '나트랑', 'Asia/Ho_Chi_Minh'],
  PQC: ['푸꾸옥국제공항', '푸꾸옥', 'Asia/Ho_Chi_Minh'],
  HPH: ['하이퐁 깟비국제공항', '하이퐁', 'Asia/Ho_Chi_Minh'],
  DLI: ['달랏 리엔크엉공항', '달랏', 'Asia/Ho_Chi_Minh'],
  BKK: ['방콕 수완나품국제공항', '방콕', 'Asia/Bangkok'],
  DMK: ['방콕 돈므앙국제공항', '돈므앙', 'Asia/Bangkok'],
  HKT: ['푸껫국제공항', '푸껫', 'Asia/Bangkok'],
  CNX: ['치앙마이국제공항', '치앙마이', 'Asia/Bangkok'],
  MNL: ['마닐라 니노이아키노국제공항', '마닐라', 'Asia/Manila'],
  CEB: ['세부 막탄국제공항', '세부', 'Asia/Manila'],
  CRK: ['클라크국제공항', '클라크', 'Asia/Manila'],
  KLO: ['칼리보국제공항(보라카이)', '칼리보', 'Asia/Manila'],
  TAG: ['보홀 팡라오국제공항', '보홀', 'Asia/Manila'],
  SIN: ['싱가포르 창이국제공항', '싱가포르', 'Asia/Singapore'],
  KUL: ['쿠알라룸푸르국제공항', '쿠알라룸푸르', 'Asia/Kuala_Lumpur'],
  BKI: ['코타키나발루국제공항', '코타키나발루', 'Asia/Kuching'],
  PEN: ['페낭국제공항', '페낭', 'Asia/Kuala_Lumpur'],
  CGK: ['자카르타 수카르노하타국제공항', '자카르타', 'Asia/Jakarta'],
  DPS: ['발리 응우라라이국제공항', '발리', 'Asia/Makassar'],
  KTI: ['프놈펜 테초국제공항', '프놈펜', 'Asia/Phnom_Penh'],
  PNH: ['프놈펜국제공항', '프놈펜', 'Asia/Phnom_Penh'],
  SAI: ['시엠립 앙코르국제공항', '시엠립', 'Asia/Phnom_Penh'],
  REP: ['시엠립국제공항', '시엠립', 'Asia/Phnom_Penh'],
  VTE: ['비엔티안 왓따이국제공항', '비엔티안', 'Asia/Vientiane'],
  RGN: ['양곤국제공항', '양곤', 'Asia/Yangon'],

  // ── 서남·중앙아시아, 중동
  DEL: ['델리 인디라간디국제공항', '델리', 'Asia/Kolkata'],
  BOM: ['뭄바이 차트라파티시바지국제공항', '뭄바이', 'Asia/Kolkata'],
  CMB: ['콜롬보 반다라나이케국제공항', '콜롬보', 'Asia/Colombo'],
  MLE: ['몰디브 벨라나국제공항', '몰디브', 'Indian/Maldives'],
  KTM: ['카트만두 트리부반국제공항', '카트만두', 'Asia/Kathmandu'],
  TAS: ['타슈켄트국제공항', '타슈켄트', 'Asia/Tashkent'],
  ALA: ['알마티국제공항', '알마티', 'Asia/Almaty'],
  NQZ: ['아스타나 누르술탄나자르바예프국제공항', '아스타나', 'Asia/Almaty'],
  DXB: ['두바이국제공항', '두바이', 'Asia/Dubai'],
  AUH: ['아부다비 자이드국제공항', '아부다비', 'Asia/Dubai'],
  DOH: ['도하 하마드국제공항', '도하', 'Asia/Qatar'],
  RUH: ['리야드 킹칼리드국제공항', '리야드', 'Asia/Riyadh'],
  JED: ['제다 킹압둘아지즈국제공항', '제다', 'Asia/Riyadh'],
  TLV: ['텔아비브 벤구리온국제공항', '텔아비브', 'Asia/Jerusalem'],
  IST: ['이스탄불공항', '이스탄불', 'Europe/Istanbul'],

  // ── 러시아
  VVO: ['블라디보스토크국제공항', '블라디보스토크', 'Asia/Vladivostok'],
  KHV: ['하바롭스크국제공항', '하바롭스크', 'Asia/Vladivostok'],
  UUS: ['유즈노사할린스크공항', '유즈노사할린스크', 'Asia/Sakhalin'],
  IKT: ['이르쿠츠크국제공항', '이르쿠츠크', 'Asia/Irkutsk'],
  SVO: ['모스크바 셰레메티예보국제공항', '모스크바', 'Europe/Moscow'],

  // ── 괌 · 사이판 · 태평양
  GUM: ['괌 안토니오 B. 원 팻 국제공항', '괌', 'Pacific/Guam'],
  SPN: ['사이판국제공항', '사이판', 'Pacific/Saipan'],
  ROR: ['팔라우 로만투멧우헬국제공항', '팔라우', 'Pacific/Palau'],
  NAN: ['피지 난디국제공항', '난디', 'Pacific/Fiji'],
  HNL: ['호놀룰루 대니얼K.이노우에국제공항', '호놀룰루', 'Pacific/Honolulu'],
  PPT: ['타히티 파아국제공항', '타히티', 'Pacific/Tahiti'],

  // ── 오세아니아
  SYD: ['시드니 킹스포드스미스국제공항', '시드니', 'Australia/Sydney'],
  MEL: ['멜버른 툴라마린공항', '멜버른', 'Australia/Melbourne'],
  BNE: ['브리즈번공항', '브리즈번', 'Australia/Brisbane'],
  PER: ['퍼스공항', '퍼스', 'Australia/Perth'],
  AKL: ['오클랜드국제공항', '오클랜드', 'Pacific/Auckland'],
  CHC: ['크라이스트처치국제공항', '크라이스트처치', 'Pacific/Auckland'],

  // ── 북미 · 중남미
  LAX: ['로스앤젤레스국제공항', 'LA', 'America/Los_Angeles'],
  SFO: ['샌프란시스코국제공항', '샌프란시스코', 'America/Los_Angeles'],
  SEA: ['시애틀 타코마국제공항', '시애틀', 'America/Los_Angeles'],
  LAS: ['라스베이거스 해리리드국제공항', '라스베이거스', 'America/Los_Angeles'],
  YVR: ['밴쿠버국제공항', '밴쿠버', 'America/Vancouver'],
  ANC: ['앵커리지 테드스티븐스국제공항', '앵커리지', 'America/Anchorage'],
  PHX: ['피닉스 스카이하버국제공항', '피닉스', 'America/Phoenix'],
  DEN: ['덴버국제공항', '덴버', 'America/Denver'],
  SLC: ['솔트레이크시티국제공항', '솔트레이크', 'America/Denver'],
  ORD: ['시카고 오헤어국제공항', '시카고', 'America/Chicago'],
  DFW: ['댈러스포트워스국제공항', '댈러스', 'America/Chicago'],
  IAH: ['휴스턴 조지부시국제공항', '휴스턴', 'America/Chicago'],
  MSP: ['미니애폴리스세인트폴국제공항', '미니애폴리스', 'America/Chicago'],
  DTW: ['디트로이트 메트로폴리탄공항', '디트로이트', 'America/Detroit'],
  ATL: ['애틀랜타 하츠필드잭슨국제공항', '애틀랜타', 'America/New_York'],
  JFK: ['뉴욕 존F.케네디국제공항', '뉴욕', 'America/New_York'],
  EWR: ['뉴어크 리버티국제공항', '뉴어크', 'America/New_York'],
  IAD: ['워싱턴 덜레스국제공항', '워싱턴', 'America/New_York'],
  BOS: ['보스턴 로건국제공항', '보스턴', 'America/New_York'],
  MIA: ['마이애미국제공항', '마이애미', 'America/New_York'],
  YYZ: ['토론토 피어슨국제공항', '토론토', 'America/Toronto'],
  MEX: ['멕시코시티국제공항', '멕시코시티', 'America/Mexico_City'],
  GRU: ['상파울루 과룰류스국제공항', '상파울루', 'America/Sao_Paulo'],

  // ── 유럽
  LHR: ['런던 히스로공항', '런던', 'Europe/London'],
  CDG: ['파리 샤를드골공항', '파리', 'Europe/Paris'],
  FRA: ['프랑크푸르트공항', '프랑크푸르트', 'Europe/Berlin'],
  MUC: ['뮌헨공항', '뮌헨', 'Europe/Berlin'],
  AMS: ['암스테르담 스히폴공항', '암스테르담', 'Europe/Amsterdam'],
  FCO: ['로마 피우미치노공항', '로마', 'Europe/Rome'],
  MXP: ['밀라노 말펜사공항', '밀라노', 'Europe/Rome'],
  VCE: ['베네치아 마르코폴로공항', '베네치아', 'Europe/Rome'],
  MAD: ['마드리드 바라하스공항', '마드리드', 'Europe/Madrid'],
  BCN: ['바르셀로나 엘프라트공항', '바르셀로나', 'Europe/Madrid'],
  LIS: ['리스본 움베르투델가두공항', '리스본', 'Europe/Lisbon'],
  ZRH: ['취리히공항', '취리히', 'Europe/Zurich'],
  VIE: ['빈 국제공항', '빈', 'Europe/Vienna'],
  PRG: ['프라하 바츨라프하벨공항', '프라하', 'Europe/Prague'],
  BUD: ['부다페스트 리스트페렌츠국제공항', '부다페스트', 'Europe/Budapest'],
  WAW: ['바르샤바 쇼팽공항', '바르샤바', 'Europe/Warsaw'],
  ZAG: ['자그레브 프라뇨투지만공항', '자그레브', 'Europe/Zagreb'],
  HEL: ['헬싱키 반타공항', '헬싱키', 'Europe/Helsinki'],
  CPH: ['코펜하겐 카스트루프공항', '코펜하겐', 'Europe/Copenhagen'],
  ARN: ['스톡홀름 알란다공항', '스톡홀름', 'Europe/Stockholm'],
  OSL: ['오슬로 가르데르모엔공항', '오슬로', 'Europe/Oslo'],
  ATH: ['아테네 엘레프테리오스베니젤로스공항', '아테네', 'Europe/Athens'],

  // ── 아프리카
  CAI: ['카이로국제공항', '카이로', 'Africa/Cairo'],
  ADD: ['아디스아바바 볼레국제공항', '아디스아바바', 'Africa/Addis_Ababa'],
  NBO: ['나이로비 조모케냐타국제공항', '나이로비', 'Africa/Nairobi'],
};

// 사용자가 직접 추가한 공항 (localStorage 저장)
const CUSTOM_AIRPORTS_KEY = 'crew-custom-airports-v1';

function loadCustomAirports() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_AIRPORTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function getAirport(code) {
  if (!code) return null;
  const custom = loadCustomAirports();
  const a = custom[code] || AIRPORTS[code];
  if (!a) return null;
  return { code, name: a[0], short: a[1], tz: a[2] };
}

function saveCustomAirport(code, name, short, tz) {
  const custom = loadCustomAirports();
  custom[code] = [name, short || name, tz];
  localStorage.setItem(CUSTOM_AIRPORTS_KEY, JSON.stringify(custom));
}

function isKnownAirport(code) {
  return !!getAirport(code);
}
