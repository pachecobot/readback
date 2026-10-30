// Banco de frases para o treino de pronúncia (ouvir e repetir).
// "say" é o que o aluno deve falar; "pt" é a tradução ou explicação.
export const PHONETIC = [
  ["A", "Alfa", "AL-fah"], ["B", "Bravo", "BRAH-voh"], ["C", "Charlie", "CHAR-lee"],
  ["D", "Delta", "DELL-tah"], ["E", "Echo", "ECK-oh"], ["F", "Foxtrot", "FOKS-trot"],
  ["G", "Golf", "GOLF"], ["H", "Hotel", "hoh-TELL"], ["I", "India", "IN-dee-ah"],
  ["J", "Juliett", "JEW-lee-ett"], ["K", "Kilo", "KEY-loh"], ["L", "Lima", "LEE-mah"],
  ["M", "Mike", "MIKE"], ["N", "November", "no-VEM-ber"], ["O", "Oscar", "OSS-cah"],
  ["P", "Papa", "pah-PAH"], ["Q", "Quebec", "keh-BECK"], ["R", "Romeo", "ROW-me-oh"],
  ["S", "Sierra", "see-AIR-rah"], ["T", "Tango", "TANG-go"], ["U", "Uniform", "YOU-nee-form"],
  ["V", "Victor", "VIK-tah"], ["W", "Whiskey", "WISS-key"], ["X", "X-ray", "ECKS-ray"],
  ["Y", "Yankee", "YANG-key"], ["Z", "Zulu", "ZOO-loo"],
];

export const NUMBERS = [
  ["0", "Zero", "ZE-RO"], ["1", "One", "WUN"], ["2", "Two", "TOO"], ["3", "Three", "TREE"],
  ["4", "Four", "FOW-er"], ["5", "Five", "FIFE"], ["6", "Six", "SIX"], ["7", "Seven", "SEV-en"],
  ["8", "Eight", "AIT"], ["9", "Nine", "NIN-er"], [".", "Decimal", "DAY-SEE-MAL"],
  ["100", "Hundred", "HUN-dred"], ["1000", "Thousand", "TOU-SAND"],
];

export const DRILLS = [
  {
    id: "alphabet", title: "Alfabeto fonético", items: [
      { say: "Papa Tango Kilo Lima Mike", pt: "Matrícula PT-KLM" },
      { say: "Papa Romeo Alfa Bravo Charlie", pt: "Matrícula PR-ABC" },
      { say: "Papa Sierra Echo Juliett X-ray", pt: "Matrícula PS-EJX" },
      { say: "Information Hotel", pt: "Informação ATIS H" },
      { say: "Holding point Delta", pt: "Ponto de espera D" },
      { say: "Taxiway Foxtrot, then Golf", pt: "Pista de táxi F, depois G" },
      { say: "Victor Whiskey Yankee Zulu", pt: "V W Y Z" },
      { say: "Quebec Uniform India November", pt: "Q U I N" },
    ],
  },
  {
    id: "numbers", title: "Números ICAO", items: [
      { say: "Runway three zero", pt: "Pista 30" },
      { say: "QNH one zero one five", pt: "Ajuste de altímetro 1015" },
      { say: "Squawk four five two one", pt: "Código transponder 4521" },
      { say: "Contact tower one one eight decimal seven", pt: "Chame a torre em 118.7" },
      { say: "Climb to three thousand five hundred feet", pt: "Suba para 3.500 pés" },
      { say: "Wind two niner zero degrees one two knots", pt: "Vento 290° com 12 nós" },
      { say: "Heading three six zero", pt: "Proa 360" },
      { say: "Flight level one two zero", pt: "Nível de voo 120" },
      { say: "Visibility one zero kilometers or more", pt: "Visibilidade 10 km ou mais" },
      { say: "Temperature two four, dew point one eight", pt: "Temperatura 24, ponto de orvalho 18" },
    ],
  },
  {
    id: "ground", title: "Solo e táxi", items: [
      { say: "Marte Ground, Papa Tango Kilo Lima Mike, Cessna one five two at the flying school, information Hotel, request taxi", pt: "Chamada inicial ao solo pedindo táxi" },
      { say: "Taxi to holding point runway three zero via Alfa, Papa Tango Kilo Lima Mike", pt: "Readback da autorização de táxi" },
      { say: "Holding short runway three zero", pt: "Mantendo antes da pista 30" },
      { say: "Give way to the Cessna crossing from left to right", pt: "Dê passagem ao Cessna cruzando da esquerda para a direita" },
      { say: "Request radio check on one two one decimal eight five", pt: "Pedido de checagem de rádio" },
      { say: "Say again, Papa Tango Kilo Lima Mike", pt: "Repita (nunca use 'repeat' na fonia)" },
      { say: "Contact tower one one eight decimal seven, Papa Tango Kilo Lima Mike", pt: "Readback de mudança de frequência" },
    ],
  },
  {
    id: "tower", title: "Torre e circuito", items: [
      { say: "Ready for departure, runway three zero", pt: "Pronto para decolar" },
      { say: "Line up and wait runway three zero", pt: "Alinhe e mantenha" },
      { say: "Cleared for takeoff runway three zero, Papa Tango Kilo Lima Mike", pt: "Readback da autorização de decolagem" },
      { say: "Downwind for touch and go", pt: "Perna do vento para toque e arremetida" },
      { say: "Number two, traffic in sight", pt: "Número dois, tráfego à vista" },
      { say: "Final runway three zero, full stop", pt: "Final, pouso completo" },
      { say: "Going around", pt: "Arremetendo" },
      { say: "Runway vacated", pt: "Pista livre" },
      { say: "Extend downwind, will call you for base", pt: "Estenda a perna do vento" },
    ],
  },
  {
    id: "enroute", title: "Navegação", items: [
      { say: "São Paulo Approach, Papa Tango Kilo Lima Mike, overhead the reporting point at two thousand five hundred feet, request to proceed to Jundiaí", pt: "Reporte de posição e intenção" },
      { say: "Squawk ident", pt: "Acione o ident do transponder" },
      { say: "Traffic in sight", pt: "Tráfego à vista" },
      { say: "Negative contact, looking out", pt: "Ainda não vi o tráfego, procurando" },
      { say: "Request descent to two thousand feet", pt: "Pedido de descida" },
      { say: "Unable, due to weather", pt: "Impossível cumprir, devido ao tempo" },
      { say: "Wilco", pt: "Entendido e cumprirei" },
    ],
  },
  {
    id: "emergency", title: "Emergência e anormais", items: [
      { say: "Mayday, Mayday, Mayday, Papa Tango Kilo Lima Mike, engine failure, forced landing, two persons on board", pt: "Chamada de socorro (Mayday)" },
      { say: "Pan pan, pan pan, pan pan, Papa Tango Kilo Lima Mike, rough running engine, request immediate return to the field", pt: "Chamada de urgência (Pan-pan)" },
      { say: "We have a passenger feeling unwell, request priority landing", pt: "Passageiro passando mal" },
      { say: "We had a bird strike on the windshield, the aircraft is controllable", pt: "Colisão com pássaro, aeronave controlável" },
      { say: "Endurance one hour three zero minutes", pt: "Autonomia 1h30" },
      { say: "Request emergency services on arrival", pt: "Pedir serviços de emergência na chegada" },
    ],
  },
  {
    id: "sounds", title: "Sons difíceis (th, h, finais)", items: [
      { say: "Three thousand feet", pt: "TH surdo: língua entre os dentes" },
      { say: "The weather is getting worse", pt: "TH sonoro + W" },
      { say: "I think the throttle is stuck", pt: "TH surdo duas vezes" },
      { say: "Hold short, hotel, heading", pt: "H aspirado, nunca como R" },
      { say: "I checked the fuel and we landed", pt: "Final -ed: checked = /t/, landed = /ɪd/" },
      { say: "Ship, sheep. Live, leave. Fill, feel.", pt: "Vogal curta x longa" },
      { say: "Taxi to the runway", pt: "Não adicione 'i' no final das palavras" },
      { say: "Thank you, three, through", pt: "TH no começo da palavra" },
    ],
  },
  {
    id: "airport", title: "Viagem: aeroporto", items: [
      { say: "Hi, I'd like to check in for my flight to Miami", pt: "Fazer check-in" },
      { say: "Could I have an aisle seat, please?", pt: "Pedir assento no corredor" },
      { say: "I'm here as a tourist for two weeks", pt: "Imigração: motivo e tempo" },
      { say: "I'm staying at a hotel near the airport", pt: "Imigração: onde vai ficar" },
      { say: "I'm a student pilot in Brazil", pt: "Imigração: ocupação" },
      { say: "Where is the gate for the connecting flight?", pt: "Perguntar o portão de conexão" },
      { say: "My bag didn't arrive. Where can I report it?", pt: "Bagagem extraviada" },
    ],
  },
  {
    id: "city", title: "Viagem: hotel e cidade", items: [
      { say: "I have a reservation under the name Silva", pt: "Tenho uma reserva no nome Silva" },
      { say: "The air conditioning in my room isn't working", pt: "O ar-condicionado não funciona" },
      { say: "Can I get the check, please?", pt: "A conta, por favor" },
      { say: "I'm allergic to peanuts", pt: "Sou alérgico a amendoim" },
      { say: "How do I get to the train station?", pt: "Como chego à estação de trem?" },
      { say: "Could you say that again a little slower?", pt: "Pode repetir mais devagar?" },
    ],
  },
];
