// Seed data for the Travel Request calculation engine, extracted from the 'drop list' sheet of
// SSA Travel Format V8-2026 - Updated (Chaung Thar).xlsm. Do not hand-edit the AREAS/TOWNSHIPS
// arrays -- regenerate from the workbook if the rate table changes.

export const TEAMS: string[] = [
  "ADM", "DSE", "EPI", "ERM/WHE", "HIV", "HSS", "MAL", "NCD", "NPO", "PLN", "RMNCAH", "TB", "WRO",
];

export const MODES_OF_TRAVEL: string[] = [
  "Air", "Boat", "Coach", "Official Vehicle", "Private Vehicle", "Cycle Taxi", "Train", "Rented vehicle",
];

export interface Deduction {
  label: string;
  /** payment % factor from the workbook's 'drop list'!N column; branch logic in calc.ts decides how it's applied */
  factor: number;
}

// Column M/N ("Deductions" / "payment %") of the 'drop list' sheet, in sheet order.
export const DEDUCTIONS: Deduction[] = [
  { label: "-", factor: 0 },
  { label: "Non-Hotel Component(None)", factor: 1 },
  { label: "Hotel + Breakfast(11%)", factor: 0.89 },
  { label: "Hotel + Lunch(22%)", factor: 0.78 },
  { label: "Hotel + Dinner(22%)", factor: 0.78 },
  { label: "Hotel + Breakfast+Lunch (33%)", factor: 0.67 },
  { label: "Hotel + 3 meals (55%)", factor: 0.45 },
  { label: "Full deduction (100%)", factor: 0 },
  { label: "day >10 hrs travel (Non-HC)", factor: 1 },
  { label: "overnight - inbound (50% origin)", factor: 1 },
  { label: "overnight - outbound (50% destination)", factor: 1 },
];

export interface Area {
  name: string;
  perdiemUsd: number;
  hotelComponent: number;
  terminalAllowanceUsd: number | null;
}

// Areas D4:D35 of the 'drop list' sheet in SSA Travel Format V8-2026 (Chaung Thar).xlsm.
// perdiemUsd = column F, hotelComponent = column H (fraction), terminalAllowanceUsd = column K
// (populated for 3 of 32 areas in the source workbook -- kept for reference, not auto-applied;
// Terminal Allowance is a manual USD field per the functional spec).
export const AREAS: Area[] = [
  { name: 'Chaung Tha Beach', perdiemUsd: 113.956466, hotelComponent: 0.7, terminalAllowanceUsd: 25 },
  { name: 'Dawei', perdiemUsd: 78.873239, hotelComponent: 0.65, terminalAllowanceUsd: 25 },
  { name: 'Dawei (Hotel Dawei)', perdiemUsd: 127.016645, hotelComponent: 0.55, terminalAllowanceUsd: 25 },
  { name: 'Elsewhere', perdiemUsd: 75.03201, hotelComponent: 0.61, terminalAllowanceUsd: null },
  { name: 'Hpa An (Hpa An Lodge)', perdiemUsd: 208.962868, hotelComponent: 0.66, terminalAllowanceUsd: null },
  { name: 'Inle (Aureum Palace and Inle Prince', perdiemUsd: 324.96799, hotelComponent: 0.69, terminalAllowanceUsd: null },
  { name: 'Loikaw', perdiemUsd: 98.079385, hotelComponent: 0.64, terminalAllowanceUsd: null },
  { name: 'Mandalay', perdiemUsd: 95.006402, hotelComponent: 0.58, terminalAllowanceUsd: null },
  { name: 'Mandalay (Hilton)', perdiemUsd: 213.060179, hotelComponent: 0.54, terminalAllowanceUsd: null },
  { name: 'Mandalay (Shwe Pyi Thar)', perdiemUsd: 184.122919, hotelComponent: 0.43, terminalAllowanceUsd: null },
  { name: 'Maw-La-Myine (Strand)', perdiemUsd: 118.053777, hotelComponent: 0.7, terminalAllowanceUsd: null },
  { name: 'Monywa (Jade Royal)', perdiemUsd: 85.019206, hotelComponent: 0.65, terminalAllowanceUsd: null },
  { name: 'Mrauk Oo', perdiemUsd: 97.055058, hotelComponent: 0.65, terminalAllowanceUsd: null },
  { name: 'Mrauk Oo (Mrauk U Prince)', perdiemUsd: 181.049936, hotelComponent: 0.62, terminalAllowanceUsd: null },
  { name: 'Myeik', perdiemUsd: 93.982074, hotelComponent: 0.53, terminalAllowanceUsd: null },
  { name: 'Naypyitaw', perdiemUsd: 100.896287, hotelComponent: 0.46, terminalAllowanceUsd: null },
  { name: 'Naypyitaw(Hilton,Kempinski,Parkryl)', perdiemUsd: 144.942382, hotelComponent: 0.48, terminalAllowanceUsd: null },
  { name: 'Ngwe Saung Beach', perdiemUsd: 119.078105, hotelComponent: 0.71, terminalAllowanceUsd: null },
  { name: 'Ngwe Saung Beach (Aureum)', perdiemUsd: 236.107554, hotelComponent: 0.57, terminalAllowanceUsd: null },
  { name: 'Nyaungoo (Tharabar,Aye Yar Rivervw)', perdiemUsd: 257.87452, hotelComponent: 0.66, terminalAllowanceUsd: null },
  { name: 'Nyaungoo-Bagan', perdiemUsd: 110.115237, hotelComponent: 0.55, terminalAllowanceUsd: null },
  { name: 'Nyaungoo-Bagan (Aureum Palace)', perdiemUsd: 308.066581, hotelComponent: 0.68, terminalAllowanceUsd: null },
  { name: 'Pathein', perdiemUsd: 103.96927, hotelComponent: 0.43, terminalAllowanceUsd: null },
  { name: 'Putao (International Staff)', perdiemUsd: 141.101152, hotelComponent: 0.64, terminalAllowanceUsd: null },
  { name: 'Putao (Local Staff)', perdiemUsd: 95.006402, hotelComponent: 0.53, terminalAllowanceUsd: null },
  { name: 'Pyinoolwin', perdiemUsd: 104.993598, hotelComponent: 0.49, terminalAllowanceUsd: null },
  { name: 'Sittwe (Royal Sittwe)', perdiemUsd: 121.126761, hotelComponent: 0.66, terminalAllowanceUsd: null },
  { name: 'Taungyi', perdiemUsd: 81.946223, hotelComponent: 0.67, terminalAllowanceUsd: null },
  { name: 'Thandwe / Ngapali Beach', perdiemUsd: 145.966709, hotelComponent: 0.55, terminalAllowanceUsd: null },
  { name: 'Yangon', perdiemUsd: 121.895006, hotelComponent: 0.61, terminalAllowanceUsd: null },
  { name: 'Yangon (Pan Pacific)', perdiemUsd: 333.930858, hotelComponent: 0.66, terminalAllowanceUsd: null },
  { name: 'Yangon (Special Hotels)', perdiemUsd: 205.889885, hotelComponent: 0.56, terminalAllowanceUsd: null },
];

// Townships O2:O331 (deduped -- source has 1 duplicate). Optional From/To Township fields.
export const TOWNSHIPS: string[] = [
  'Ahlone', 'Amarapura', 'Ann', 'Aunglan', 'Aungmyaythazan', 'Ayadaw', 'Bago', 'Bahan', 'Banmauk', 'Bawlakhe',
  'Bhamo', 'Bilin', 'Bogale', 'Bokpyin', 'Botahtaung', 'Budalin', 'Buthidaung', 'Chanayethazan', 'Chanmyathazi',
  'Chauk', 'Chaung-U', 'Chaungzon', 'Chipwi', 'Cocokyun', 'Dagon', 'Dagon-seikkan', 'Daik_U', 'Dala', 'Danubyu',
  'Dawbon', 'Dawei', 'Dedaye', 'Dekhina Thiri', 'Demoso', 'East-dagon', 'Einme', 'Falam', 'Gangaw', 'Gwa',
  'Gyobingauk', 'Hakha', 'Hinthada', 'Hkamti', 'Hlaing', 'Hlaingbwe', 'Hlaing-thar-ya', 'Hlegu', 'Hmawbi',
  'Homalin', 'Hopang', 'Hopong', 'Hpa-An', 'Hpakan', 'Hpapun', 'Hpasawng', 'Hpruso', 'Hseni', 'Hsihseng', 'Hsipaw',
  'Htantabin', 'Htantlang', 'Indaw', 'Ingapu', 'Injangyang', 'Insein', 'Kalaw', 'Kale', 'Kalewa', 'Kamaryut',
  'Kamma', 'Kanbalu', 'Kangyidaunt', 'Kani', 'Kanpalat', 'Katha', 'Kawa', 'Kawhmu', 'Kawkareik', 'Kawlin',
  'Kawthoung', 'Kayan', 'Kengtung', 'Khaunglanphu', 'Khin-U', 'KonKyan', 'Kungyangon', 'Kunhein', 'Kunlong',
  'Kutkai', 'Kyaiklat', 'Kyaikmaraw', 'Kyaikto', 'Kyain Seikgyi', 'Kyangin', 'Kyaukkyi', 'Kyaukme', 'Kyaukpadaung',
  'Kyaukpyu', 'Kyaukse', 'Kyauktada', 'Kyauktaga', 'Kyauktan', 'Kyauktaw', 'Kyaunggon', 'Kyee-myin-dain', 'Kyethi',
  'Kyonpyaw', 'Kyunhla', 'Kyunsu', 'Labutta', 'Lahe', 'Lanmadaw', 'Lashio', 'Latha', 'Laukkaing', 'Launglon',
  'Lawksawk', 'Lay Shi', 'Lecha', 'Lemyethna', 'Letpadan', 'Lewe', 'Lingkho', 'Loikaw', 'Loilin', 'Ma Bein',
  'Machanbaw', 'Madaya', 'Madupi', 'Magway', 'Mahaaungmyay', 'Mahlaing', 'Mangyan', 'Manphant', 'Mansi', 'Manton',
  'Matman', 'Maubin', 'Mauk mai', 'Maungdaw', 'Mawlaik', 'Mawlamyine', 'Mawlamyinegyun', 'Mayangone', 'Meiktila',
  'Mese', 'Minbu', 'Minbya', 'Mindat', 'Mindon', 'Mingaladon', 'Mingalar-taung-nyunt', 'Mingin', 'Minhla',
  'MoeNyo', 'Mogaung', 'Mogoke', 'Mohnyin', 'Momauk', 'Mong Kaung', 'Monghsat', 'Monghsu', 'Mongkhet', 'Mongmaw',
  'Mongmit', 'Mongnai', 'Mongpan', 'Mongpyak', 'Mongpyin', 'Mongton', 'Mongyai', 'Mongywang', 'Monywa', 'Mrauk-U',
  'Mudon', 'Munaung', 'Muse', 'Myaing', 'Myanaung', 'Myaung', 'Myaungmya', 'Myawady', 'Myebon', 'Myeik',
  'Myingyan', 'Myinmu', 'Myitkyina', 'Myittha', 'Myothit', 'Nahpant', 'Namhsan', 'Namsang', 'Namtu', 'Nan Kham',
  'Nanyun', 'Natmauk', 'Natogyi', 'Nattalin', 'Naung Khio', 'Nawngmun', 'Ngape', 'Ngapudaw', 'Ngazun',
  'North-dagon', 'North-okkalapa', 'Nyaung Lay Pin', 'Nyaung_U', 'Nyaungdon', 'Nyaungshwe', 'Oaktaya Thiri',
  'Okpho', 'Oktwin', 'Pabedan', 'Padaung', 'Pakokku', 'Palaw', 'Pale', 'Paletwa', 'Pangyang', 'Pantanaw',
  'Panwaing', 'Pathein', 'Patheingyi', 'Pauk', 'Paukkhaung', 'Pauktaw', 'Paung', 'Paungbyin', 'Paungde',
  'Pazundaung', 'Phekon', 'Phyu', 'Pindaya', 'Pinglong', 'Pinlebu', 'Pobba Thiri', 'Ponnagyun', 'Puta-O',
  'Pwintbyu', 'Pyapon', 'Pyawbwe', 'Pyay', 'Pyigyitagon', 'Pyinmana', 'Pyinoolwin', 'Ramree', 'Rathedaung',
  'Sagaing', 'Salin', 'Salingyi', 'Sanchaung', 'Saw', 'Seikgyikhanaun', 'Seikkan', 'Seikphyu', 'Shadaw', 'Shwebo',
  'Shwedaung', 'Shwegu', 'Shwegyin', 'Shwe-pyi-thar', 'Sidoktaya', 'Sinbaungwe', 'Singu', 'Sintgaing', 'Sittwe',
  'South-dagon', 'South-okkalapa', 'Sumprabum', 'Tabayin', 'Tachileik', 'Tada_U', 'Taikkyi', 'Tamu', 'Tanai',
  'Tangyan', 'Taninthayi', 'Tantabin', 'Tarmwe', 'Tatkon', 'Taungdwingyi', 'Taunggyi', 'Taungoo', 'Taungtha',
  'Taze', 'Thabaung', 'Thabeikkyin', 'Thaketa', 'Thanatpin', 'Thanbyuzayat', 'Thandaung', 'Thandwe', 'Thanlyin',
  'Thaton', 'Thayarwady', 'Thayet', 'Thayetchaung', 'Thazi', 'Thegon', 'Thingangyun', 'Thongwa', 'Tiddim',
  'Tigyaing', 'Tilin', 'Tonzang', 'Toungup', 'Tsawlaw', 'Twantay', 'Waingmaw', 'Wakema', 'Waw', 'Wetlet',
  'Wundwin', 'Wuntho', 'Yamethin', 'Yankin', 'Ye', 'Yebyu', 'Yedashe', 'Yegyi', 'Yenangyaung', 'Yesagyo', 'Ye-U',
  'Yinmabin', 'Ywangan', 'Zalun', 'Zebu Thiri', 'Zeya Thiri', 'Zigon',
];

const AREA_BY_NAME = new Map(AREAS.map((a) => [a.name, a]));

export function findArea(name: string): Area | undefined {
  return AREA_BY_NAME.get(name);
}

export function findDeduction(label: string): Deduction | undefined {
  return DEDUCTIONS.find((d) => d.label === label);
}

/** Daily rate (DSA) for an area: Perdiem x (1 - Hotel component) x 90%. */
export function dailyRate(areaName: string): number {
  const area = findArea(areaName);
  if (!area) return 0;
  return area.perdiemUsd * (1 - area.hotelComponent) * 0.9;
}
