# Game night

Two party games for the TV: **Hangman** and **Family Face-Off** (a survey game show). The TV shows the board; everyone plays on their own phone. Switch games from the TV lobby.

- **TV:** open `/tv` (full screen it). The lobby shows a QR code and a 4 letter code.
- **Phones:** scan the QR code, or open the site and type the code and a name.
- Only one game runs at a time. Opening `/tv` on another screen offers to move the game there.

## Rules

A right letter scores 1 point per spot and you go again. Three right in a row puts you on fire: double points until you miss. Solve it pays 2 points per hidden letter, but a wrong answer costs a miss and your turn. Finishing the phrase is worth 3 bonus points. Six misses and the round is lost. With the shot clock on, each turn has 15 seconds and a solve has 20.

**Showtime:** whoever solves it gets a singing challenge. Everyone else votes on their phone (1 to 3) and the performer gets the average.

**Secret phrase mode:** players take turns typing a phrase on their phone. The person who typed it sits that round out.

## Family Face-Off

Every player is their own family (2 to 8 players).

- **Face-off:** everyone buzzes in on their phone. The first two answer; the higher answer on the board wins control (the top answer wins outright). If both miss, the buzzer reopens.
- **Play or pass**, then the family in control names answers until the board is cleared or they get three strikes.
- **Steal:** after three strikes, everyone else types one answer. The earliest right answer takes the bank; if nobody gets one, the family in control keeps it.
- Round 3 is double points, round 4 on is triple. First to the target (200, 300 or 500) plays **Fast Money** with a partner they pick (or plays both halves): five questions in 20 seconds, then the partner gets 25 seconds and can't repeat an answer. 200 points wins.
- Typed answers are matched automatically (plurals, "a"/"the", small typos, and the other wordings in the survey file). When it misses one, the TV shows **That counts** to credit the right answer, and **Give a strike** for someone who stalls.

### Sound

The TV plays every sound; phones only buzz (and play the buzzer when you hit BUZZ). The effects are built into the game (`public/feud-sounds.js`): the bell for a right answer, the strike buzzer, brass stings, the Fast Money buzzers and a studio audience. When someone answers, the TV puts their answer up big and the host says "Survey says!" (using the TV browser's built-in voice), then the tile flips or the X comes down. The host also reads each question. **Host voice** and **Sound** buttons on the TV turn these off.

To use your own recordings, add `.mp3` files to `public/sounds/` with these names; each one replaces the built-in sound:

| File | Plays when |
|---|---|
| `ding.mp3` | a right answer flips over |
| `strike.mp3` | a strike (the big red X) |
| `buzzin.mp3` | someone buzzes in at the face-off |
| `flip.mp3` | missed answers turn over at the end of a round |
| `round.mp3` | each round starts |
| `theme.mp3` | the first round of a game starts (instead of `round`) |
| `control.mp3` | someone wins the face-off |
| `steal.mp3` | three strikes; time to steal |
| `win.mp3` | a board is won or stolen |
| `keep.mp3` | a steal fails |
| `fastStart.mp3` / `fastEnd.mp3` | the Fast Money clock starts / runs out |
| `fastZero.mp3` | a Fast Money answer scores nothing |
| `dupe.mp3` | a repeated Fast Money answer |
| `champ.mp3` | the final scores |
| `join.mp3`, `lock.mp3`, `tick.mp3` | someone joins, a steal is locked in, the last 5 seconds |

### Surveys

Questions are `.txt` files in [`surveys/`](surveys):

```
? Name something people take to the beach.
SUNSCREEN 31 / SUNBLOCK / LOTION
TOWEL 24 / BEACH TOWEL
```

`?` starts a question. Each answer line is the answer as shown on the board, its points, then other ways people might say it after slashes. 3 to 8 answers, highest points first, adding up to 100 or less. `npm test` checks every file, including that no wording matches the wrong answer.

## Themes

Themes are `.txt` files in [`themes/`](themes). Every file there shows up in the TV's theme list. To add or change one, commit the file to `main`; Render redeploys in about a minute.

```
# Theme: Christmas
## Movies
HOME ALONE
ELF
## Food
CANDY CANE
```

- `# Theme name` on the first line (optional; the file name is used otherwise).
- `## Category` headings. The category is shown on the TV as the hint.
- One phrase per line: letters, spaces, apostrophes and hyphens, up to 40 characters. Accents are dropped (JALAPEÑO becomes JALAPENO).
- Lines starting with `//` are notes and are ignored.

`npm test` checks every theme file and fails on any line the game would skip, so a typo can't quietly drop a phrase.

`game-night.txt` has 38 topics and over 1,300 phrases.

## Running

```
npm install
npm start        # http://localhost:3000/tv
npm test
```

## How it works

`server.js` serves the pages and a WebSocket at `/ws`. `lib/game.js` holds the one game: players, turns, scoring and the shot clock all run on the server, so the TV and the phones are just screens. The hidden phrase is never sent to any screen until the round is over. `lib/themes.js` reads the theme files.
