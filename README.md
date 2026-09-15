# LoL Fantasy Manager

Online multiplayer fantasy manager pro League of Legends. 1–10 hráčů draftuje
pro-hráče LEC napříč rolemi TOP/JNG/MID/ADC/SUP, poté proběhne simulovaná
liga a vítězí manažer s nejvíc fantasy body.

```
lol-fantasy-manager/
├── backend/   Node.js + Express + Socket.io (lobby, draft, simulátor, liga)
└── frontend/  React (Vite) klient
```

---

## 1. Požadavky

- **Node.js 18+** (testováno na v22) a npm
- Dva terminály (jeden pro backend, jeden pro frontend), případně dvě karty terminálu

Ověření verze:

```bash
node -v
npm -v
```

---

## 2. Spuštění backendu

```bash
cd backend
npm install
npm start
```

Server naslouchá na `http://localhost:4000` (lze změnit proměnnou prostředí
`PORT`). Při startu se do konzole vypíše počet načtených pro-hráčů a rolí —
tím se ověří, že `data/players.json` je v pořádku:

```
LoL Fantasy Manager backend běží na http://localhost:4000
Pro-hráčů v databázi: 50, role: TOP, JNG, MID, ADC, SUP
```

Pro vývoj s automatickým restartem při změně souboru:

```bash
npm run dev
```

### Proměnné prostředí (backend)

| Proměnná | Výchozí hodnota | Popis |
|---|---|---|
| `PORT` | `4000` | Port, na kterém server běží |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Povolený CORS origin pro Socket.io (adresa frontendu) |

Příklad spuštění na jiném portu:

```bash
PORT=5000 CLIENT_ORIGIN=http://localhost:5173 npm start
```

---

## 3. Spuštění frontendu

V novém terminálu:

```bash
cd frontend
npm install
npm run dev
```

Vite spustí dev server na `http://localhost:5173`. Otevři tuto adresu
v prohlížeči — pro lokální test víc "hráčů" stačí otevřít víc karet/oken
(každé dostane vlastní Socket.io spojení a tedy vlastní hráčskou identitu).

### Proměnné prostředí (frontend)

Pokud backend neběží na výchozí adrese `http://localhost:4000`, vytvoř
v `frontend/` soubor `.env`:

```
VITE_SERVER_URL=http://localhost:5000
```

---

## 4. Jak hra funguje (pro hráče)

**Klíčový princip:** Po draftu se tvůj vydraftovaný roster (5 pro-hráčů
napříč různými LEC organizacemi) stává **tvým vlastním fantasy týmem**,
kterým nastupuješ do zápasů proti ostatním manažerům — ne že by se
simulovaly zápasy originálních LEC organizací s jejich původním složením.
Liga i play-off jsou tedy zápasy "tvůj roster vs. roster soupeře".

1. Jeden hráč klikne **Vytvořit lobby** → zadá přezdívku a volitelně název
   svého fantasy týmu (necháš-li prázdné, dosadí se automaticky) → dostane
   6místný kód a pošle ho ostatním. Svůj tým máš vždy vidět v horní liště
   ("TVŮJ TÝM ...").
2. Ostatní se připojí přes **Připojit se** + kód (a taky si zvolí přezdívku
   + volitelně název týmu).
3. Podporováno je 1–10 reálných hráčů (1 hráč = hraješ čistě proti botům).
   Zbylá místa do 10 týmů doplní boti.
4. Host klikne **Spustit draft**. Následuje:
   - **Fáze 1:** Snake Draft výhradně mezi reálnými hráči, 5 kol (=
     počet rolí v rosteru). V každém kole si hráč na tahu vybere
     **kteréhokoliv volného pro-hráče z libovolné role** — draft není
     vázaný na pevné pořadí TOP→JNG→MID→ADC→SUP. Jediné omezení: roli,
     kterou už máš ve svém rosteru obsazenou, si nemůžeš vybrat znovu.
     Pořadí hráčů se v každém kole podle klasického snake draftu obrací.
   - **Fáze 2:** Jakmile lidé dodraftují (každý má obsazených všech 5
     rolí), boti si automaticky rozeberou zbylé sloty podle nejvyššího
     PR (Player Ranking) mezi volnými hráči.
5. Po dokončení draftu se automaticky spustí **regulérní sezóna** —
   round-robin rozpis zápasů mezi 10 FANTASY TÝMY (9 kol). Každé kolo hraje
   tvůj roster proti rosteru jiného manažera/bota; fantasy body z tohoto
   zápasu jdou přímo do tvých standings. Host tlačítky **Simulovat další
   kolo** / **Dohrát sezónu** spouští simulace; všem hráčům v lobby se v
   reálném čase aktualizuje pořadí (včetně bilance výher/proher).
6. Po odehrání všech kol regulérní sezóny host klikne **Spustit play-off**.
   Do play-off postupuje **6 nejlepších fantasy týmů** (podle bilance
   výher, remízy dle celkových fantasy bodů) ve formátu **double
   elimination** — stejný formát jako reálná LEC/LCS:
   - **Horní pavouk, kolo 1:** 1. seed vs 4. seed, 2. seed vs 3. seed
   - **Dolní pavouk, kolo 1:** 5. seed vs 6. seed — poražený je rovnou
     vyřazen na 5.–6. místě (nemá druhý pokus)
   - **Finále horního pavouka:** vítězové z horního kola 1 → vítěz
     postupuje rovnou do Grand Finále, poražený spadá do dolního pavouka
   - **Dolní pavouk, kolo 2:** poražení z horního kola 1 vs vítěz dolního
     kola 1
   - **Finále dolního pavouka:** vítěz dolního kola 2 vs poražený z
     finále horního pavouka
   - **Grand Finále:** šampion horního pavouka vs vítěz dolního pavouka

   Každý zápas je jedno simulované utkání (Bo1), stejně jako v regulérní
   sezóně. Fantasy body z play-off zápasů se počítají s bonusovým
   násobičem **×1.5** (vyšší sázky). Host spouští jednotlivé fáze pavouka
   přes **Simulovat další kolo play-off** / **Dohrát play-off**.
7. Po finále se zobrazí **vítěz play-off** (fantasy tým, který vyhrál
   finálový zápas) i **nejvíc bodů celkem** (manažer s nejvíc fantasy body
   za celou sezónu + play-off) — nemusí to být nutně stejný tým, protože o
   postupu v pavouku rozhoduje výsledek zápasu, ne kdo nasbíral víc bodů.
8. V přehledu kola i v detailu play-off zápasů se zápasy, kde hraje tvůj
   tým, zvýrazní zlatě a automaticky rozbalí, takže vždy poznáš, který
   zápas je "tvůj".

---

## 5. Nahrazení dat hráčů vlastním ratingem


Databáze pro-hráčů žije v jednom souboru:

```
backend/data/players.json
```

Stačí ho přepsat — žádný jiný soubor se měnit nemusí. Formát (pole objektů):

```json
{
  "id": "faker",
  "name": "Faker",
  "team": "T1",
  "role": "MID",
  "pr": 99,
  "lp": 90,
  "m": 95,
  "c": 80
}
```

| Pole | Popis |
|---|---|
| `id` | unikátní string |
| `name` | zobrazované jméno |
| `team` | "reálná" LEC organizace hráče — jen popisný údaj zobrazený v draft poolu, neovlivňuje rozpis ligy (rozpis se generuje mezi fantasy týmy manažerů, viz sekce 4) |
| `role` | `TOP`, `JNG`, `MID`, `ADC` nebo `SUP` |
| `pr` | Player Ranking, 1–99 |
| `lp` | Laning Power, 1–99 |
| `m` | Mechanics / Fighting Power, 1–99 |
| `c` | Consistency, 1–100 (1 = velký coinflip, 100 = stabilní výkon) |

**Pravidla, která data musí splňovat** (server je při startu ověří a
nespustí se, pokud nesedí — chybová hláška řekne přesně, co opravit):

1. Každý `team` musí mít **přesně jednoho** hráče na každou z 5 rolí (jde
   jen o validaci konzistence dat, ne o herní mechaniku - simulují se
   zápasy fantasy rosterů, ne zápasy mezi `team` skupinami).
2. Aby šlo naplnit draft pro až 10 fantasy manažerů, je potřeba mít
   **alespoň 10 hráčů na každou roli** napříč všemi `team` skupinami.
3. Doporučený, ale ne vyžadovaný, je sudý počet `team` skupin.

Momentálně je nahraný kompletní roster **LEC 2026** (G2 Esports, Karmine
Corp, Movistar KOI, Fnatic, Team Vitality, GIANTX, SK Gaming, Team
Heretics, Shifters, Natus Vincere).

---

## 6. Bodovací systém (Fantasy Points)

Přesně podle zadání, implementováno v `backend/game/scoring.js`:

| Statistika | Body |
|---|---|
| Kill | +3.0 |
| Assist | +2.0 |
| Death | −1.5 |
| CS (Creep Score) | +0.02 / kus |
| Vision Score | +0.1 / bod |
| Výhra týmu | +2.0 |
| First Blood | +2.0 |
| Quadrakill | +3.0 |
| Pentakill | +5.0 |

```
Fantasy Body = Kills×3 + Assists×2 − Deaths×1.5 + CS×0.02 + Vision×0.1 + Bonusy
```

**Play-off bonus:** body z play-off zápasů (double-elimination pavouk pro 6 týmů) se do
celkových standings započítávají s násobičem **×1.5** oproti výše uvedenému
vzorci — odráží to vyšší sázky vyřazovací fáze. Konfigurovatelné přes
`PLAYOFF_MULTIPLIER` v `backend/game/leagueManager.js`.

---

## 7. Jak funguje simulátor zápasu

Implementace: `backend/game/simulator.js`. Tři fáze:

1. **Early Game (Laning):** `teamLP = Σ LP hráčů + náhodný team-roll (−15
   až +15)`. Tým s vyšším skóre získává Gold Lead.
2. **Mid/Late Game (Teamfighty):** `teamFP = Σ efektivní Fighting Power`
   (odchylka na hráče podle Consistency — nižší `c` = větší náhodný
   výkyv). Vítěz Early Game dostává **+5 % až +10 % bonus** k Fighting
   Power (škáluje se podle velikosti gold leadu). Vyšší finální Fighting
   Power vyhrává zápas.
3. **Individual Stats:** K/D/A vážené rolí (víc killů ADC/MID, víc assistů
   SUP/JNG), CS a Vision Score odvozené od délky zápasu (22–42 min,
   jednostranné zápasy jsou kratší), First Blood, Quadra/Pentakill.

---

## 8. Struktura backendu

```
backend/
├── server.js              Express + Socket.io, všechny eventy
├── data/
│   ├── players.js          Načtení + validace players.json
│   └── players.json        DATABÁZE HRÁČŮ - sem patří vlastní data
└── game/
    ├── scoring.js           Výpočet fantasy bodů
    ├── simulator.js          simulateMatch() - jádro simulace
    ├── draftManager.js       Snake draft + bot draft
    ├── lobbyManager.js       Lobby, kódy, sloty, boti
    └── leagueManager.js      Round-robin rozpis, kola, standings
```

### Socket.io eventy (přehled)

**Klient → server**

| Event | Payload | Popis |
|---|---|---|
| `lobby:create` | `{ playerName, teamName? }` | Vytvoří lobby, callback vrátí `{ code }` |
| `lobby:join` | `{ code, playerName, teamName? }` | Připojí se do existující lobby |
| `lobby:start` | `{ code }` | Host spustí draft (doplní boty) |
| `draft:pick` | `{ code, proPlayerId }` | Hráč na tahu vybere pro-hráče |
| `league:simulateRound` | `{ code }` | Host odsimuluje další kolo regulérní sezóny |
| `league:simulateAll` | `{ code }` | Host dohraje zbytek regulérní sezóny najednou |
| `league:startPlayoffs` | `{ code }` | Host sestaví play-off pavouka (po konci sezóny) |
| `league:simulatePlayoffRound` | `{ code }` | Host odsimuluje další play-off kolo |
| `league:simulateAllPlayoffs` | `{ code }` | Host dohraje zbytek play-off najednou |

**Server → klient**

| Event | Popis |
|---|---|
| `lobby:update` | Aktuální stav lobby (hráči + jejich názvy týmů, boti, může-li se startovat) |
| `draft:update` | Aktuální stav draftu (kdo je na řadě, rostery, dostupní hráči) |
| `draft:complete` | Draft (včetně botů) je hotový |
| `league:ready` | Regulérní sezóna je připravená, obsahuje rozpis a počáteční standings |
| `league:roundResult` | Výsledky odehraného kola regulérní sezóny (detailní staty zápasů) |
| `league:regularSeasonComplete` | Všech 9 kol regulérní sezóny odehráno |
| `league:playoffReady` | Play-off pavouk sestaven (nasazení, kola) |
| `league:playoffUpdate` | Aktuální stav celého play-off pavouka po každém kole |
| `league:playoffRoundResult` | Výsledky odehraného play-off kola |
| `league:standings` | Aktualizované průběžné pořadí (regulérní sezóna + play-off) |
| `league:finished` | Play-off skončil - finální pořadí, vítěz play-off (fantasy tým) a tým s nejvíc body celkem |
| `error:message` | Chybová hláška (např. "nejsi na řadě") |

---

## 9. Nasazení / produkce (stručně)

- **Backend:** `npm start` na serveru s Node.js, nastav `PORT` a
  `CLIENT_ORIGIN` na skutečnou doménu frontendu. Lobby jsou uložené jen
  v paměti procesu — při restartu serveru se ztratí (pro produkční
  nasazení by to chtělo perzistentní úložiště, např. Redis).
- **Frontend:** `npm run build` vytvoří statické soubory v `frontend/dist/`,
  které lze nasadit na libovolný static hosting (Vercel, Netlify, Nginx...).
  Nezapomeň nastavit `VITE_SERVER_URL` na produkční adresu backendu před
  buildem.

---

## 10. Řešení problémů

**`npm install` v backendu hlásí `E404` na `@types/node`:** Stalo se to v
sandboxovém prostředí kvůli nekonzistenci registry mirroru; `package.json`
už obsahuje `overrides` pinující funkční verzi, takže by se to nemělo
opakovat. Pokud přesto narazíš na podobnou chybu, zkus `npm cache clean
--force` a instalaci zopakuj.

**Frontend se nemůže připojit k backendu (spinner "Připojování..."
navěky):** Zkontroluj, že backend běží a že `VITE_SERVER_URL` (frontend) a
`CLIENT_ORIGIN` (backend) odpovídají skutečným adresám a portům. Zkontroluj
konzoli prohlížeče pro CORS chyby.

**Server při startu spadne s chybou o `data/players.json`:** Chybová
hláška přesně řekne, co je špatně (duplicitní role v týmu, chybějící pole,
hodnota mimo rozsah...). Oprav podle popisu v sekci 5.
