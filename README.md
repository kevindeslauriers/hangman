# Hangman

Family Hangman for the TV. The TV shows the board; everyone plays their turns on their own phone.

- **TV:** open `/tv` (full screen it). The lobby shows a QR code and a 4 letter code.
- **Phones:** scan the QR code, or open the site and type the code and a name.
- Only one game runs at a time. Opening `/tv` on another screen offers to move the game there.

## Rules

A right letter scores 1 point per spot and you go again. Three right in a row puts you on fire: double points until you miss. Solve it pays 2 points per hidden letter, but a wrong answer costs a miss and your turn. Finishing the phrase is worth 3 bonus points. Six misses and the round is lost. With the shot clock on, each turn has 15 seconds and a solve has 20.

**Showtime:** whoever solves it gets a singing challenge. Everyone else votes on their phone (1 to 3) and the performer gets the average.

**Secret phrase mode:** players take turns typing a phrase on their phone. The person who typed it sits that round out.

## Themes

Upload a theme from the TV lobby. A theme is a plain `.txt` file:

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
- Uploading a theme with the same name again replaces it.

`samples/test-theme.txt` is a sample to try. `themes/family.txt` is the built-in theme from the original game.

Uploaded themes are saved in `$DATA_DIR/themes` (the Render persistent disk).

## Running

```
npm install
npm start        # http://localhost:3000/tv
npm test
```

Environment variables:

- `PORT`: set by Render.
- `DATA_DIR`: where uploaded themes are kept. On Render this is the disk mount, `/var/data`.
- `ADMIN_KEY` (optional): lets scripts upload themes without the TV, with the header `X-Host-Key: <ADMIN_KEY>`:
  `curl -X POST --data-binary @samples/test-theme.txt -H "X-Host-Key: $ADMIN_KEY" "https://<site>/api/themes?filename=test-theme.txt"`

## How it works

`server.js` serves the pages and a WebSocket at `/ws`. `lib/game.js` holds the one game: players, turns, scoring and the shot clock all run on the server, so the TV and the phones are just screens. The hidden phrase is never sent to any screen until the round is over. `lib/themes.js` parses and stores themes.
