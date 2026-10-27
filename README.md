# Game night

Four party games for the TV: **Hangman**, **Family Face-Off** (a survey game show), **Spin & Solve** (a wheel-and-puzzle game show) and **Answer Board** (a quiz-board game show). The TV shows the board; everyone plays on their own phone. Switch games from the TV lobby.

- **TV:** open `/tv` (full screen it). The lobby shows a QR code and a 4 letter code.
- **Phones:** scan the QR code, or open the site and type the code and a name.
- Only one game runs at a time. Opening `/tv` on another screen offers to move the game there.

## Rules

A right letter scores 1 point per spot and you go again. Three right in a row puts you on fire: double points until you miss. Solve it pays 2 points per hidden letter, but a wrong answer costs a miss and your turn. Finishing the phrase is worth 3 bonus points. Six misses and the round is lost. With the shot clock on, each turn has 15 seconds and a solve has 20.

**Showtime:** whoever solves it gets a singing challenge. Everyone else votes on their phone (1 to 3) and the performer gets the average.

**Secret phrase mode:** players take turns typing a phrase on their phone. The person who typed it sits that round out.

## Answer Board

A quiz board for trivia night, with an easy set of clues for kids.

- Six categories, five clues each ($200 to $1,000; the second board is doubled). The player in control picks a clue on their phone (the TV can pick too, by clicking a value).
- The host reads the clue, then everyone races to **BUZZ**. Right answers win the money and control; after a wrong answer, anyone else can buzz. If nobody gets it, the answer is shown.
- **Clues:** *Challenging* (the default, pub-trivia level: $200 is gettable, $1,000 is hard) or *Easy (for kids)*, chosen in the lobby.
- Players type their answers, with no need to say "What is…" and typos forgiven. **Multiple choice** (off by default) gives four answers to tap instead (the other answers in the category).
- Wrong answers cost nothing unless **Wrong answers lose points** is on.
- Hidden **Daily Doubles** (one on the first board, two on the second): the picker wagers $5 up to their score or the board's top value.
- **Final round:** everyone secretly wagers on the category, then answers the clue in 30 seconds to an original thinking tune. Answers are revealed from last place up.
- Options in the lobby: clue difficulty, one or two boards, multiple choice, wrong-answer penalty, final round. **End round** on the TV skips the rest of a board.

### Clues

Clues are `.txt` files in [`clues/`](clues):

```
## ANIMAL SOUNDS
1 | This farm animal says "moo" | COW / COWS / CATTLE
2 | ...
5 | ...
FINAL | SPACE | This is the closest star to Earth | THE SUN / SUN | THE NORTH STAR; THE MOON; SIRIUS
```

`standard.txt` holds the challenging clues and `easy.txt` the kids' ones; a `# Difficulty: easy` line at the top of a file marks it easy. Each category has one clue at each level 1 (easiest, $200) to 5 ($1,000): level, clue, then the answer and other ways to say it after slashes. Keep a category's answers the same kind of thing, since they are the wrong choices in multiple choice. A final clue lists its own three wrong choices. `npm test` checks every file.

## Spin & Solve

Puzzles come from the Hangman themes (every phrase that fits the 4-row, 12/14/14/12 board), with the theme's category shown under the board.

- **Toss-up** before each round: letters appear one at a time. Buzz in on your phone and solve to win cash ($1,000, $2,000, then $3,000) and start the round. A wrong answer locks you out of that toss-up.
- **Your turn:** press and hold **SPIN** on your phone and let go (a longer hold spins harder). Call a consonant to win the wedge value for each one in the puzzle. Vowels cost $250. Solve any time on your turn. A missing letter, a wrong solve or running out of time passes play.
- **Bankrupt** wipes your round money; **Lose a Turn** passes play. Only the player who solves banks their round money (at least $1,000).
- After the last round (2 to 5, set in the lobby) the leader plays the **Bonus Round**: R S T L N E are given, they pick 3 more consonants and a vowel, then get 10 seconds (and as many guesses as they like) to solve for a mystery prize.
- Sounds: pegs clicking as the wheel slows, a ding for every letter, the buzzer, the Bankrupt horn and a cash register for vowels; the host voice reads the category and counts the letters. Recordings named `wheel-<sound>.mp3` (`wheel-tick`, `wheel-ding`, `wheel-buzz`, `wheel-bankrupt`, `wheel-solve` and so on; see `public/wheel-sounds.js`) in `public/sounds/` replace them.

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
