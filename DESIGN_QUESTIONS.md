# Game Design Questions – Your Input Needed

Before we start implementation, please decide on these. Your answers will be documented and used throughout the project.

---

## 1. Draft

### 1.1 Draft format
- **Snake draft**: Pick 1, 2, 3… 3, 2, 1, 1, 2, 3… (traditional)
- **Auction**: Each user has $25, bid on players
- **Blind pick**: Everyone picks at once, no turn order (simpler but can cause conflicts)

**Recommendation**: Snake draft is familiar and easy to implement.

**Your choice**: Since there are only 15-20 players in the U21 team - we will have duplicated. There is no need for an official draft - every user that signs up picks his team, and joins the league.

### 1.2 Roster size
- Minimum and maximum number of players per roster?
- With $25 cap and $1–10 prices: 3–25 players possible. Typical might be 5–8.

**Your choice**: 5 Players EXACTLY.

### 1.3 Draft timing
- Before first U21 game of the season?
- Allow late joiners with auto-draft or different rules?

**Your choice**: Answered that in 1.1

---

## 2. Scoring

### 2.1 Which games count?
- **All games** (including scrimmages)
- **Exclude scrimmages** (only competitive)
- **Exclude scrimmages + playoffs** (only qualifiers)

**Recommendation**: Exclude scrimmages; include qualifiers and playoffs.

**Your choice**: Exclude scrimmages; include qualifiers and playoffs.

### 2.2 Multiple games per week
- If Israel plays 2 games in a week, do we sum fantasy points from both?
- Or use best game / average?

**Recommendation**: Sum both games (more data, rewards consistency).

**Your choice**: Sum both games on paper, but it shouldn't happen, there is up to one weekly U21 game.

### 2.3 DNP (Did Not Play)
- Player on roster but doesn’t play → 0 points. Confirm?

**Your choice**: Yes, and it should be a minimum (every player that plays will score >= 0 points)

---

## 3. Substitutions

### 3.1 Definition of “week”
- **Calendar week** (Mon–Sun)
- **Between games** (e.g. after game 1, before game 2)
- **Game week** (our custom “week” aligned to U21 schedule)

**Recommendation**: Game week = period between U21 game days. Simpler and aligned with data.

**Your choice**: Game week = period between U21 game days. Simpler and aligned with data.

### 3.2 Lock time
- When do subs lock? (e.g. 1 hour before first game of the week)

**Your choice**: 1 hour before first game of the week

### 3.3 Subbing a player who already played
- Can you sub out a player who already played this week? (Usually no – they’ve already scored.)

**Recommendation**: No. Once a game is played, that player’s points are locked.

**Your choice**: There is only 1 weekly game so this question is not relevant.

---

## 4. Price Changes

### 4.1 Frequency
- **After each game**
- **Weekly** (e.g. every Monday)
- **Bi-weekly**

**Recommendation**: Weekly, after all games in that week are done.

**Your choice**: Weekly, after the weekly game is done (Monday)

### 4.2 Magnitude
- Max change per update: ±$1? ±$2?
- Should prices ever go below $1 or above $10?

**Recommendation**: ±$1 per update, clamp to $1–10.

**Your choice**: ±$1 per update, clamp to $1–10.

### 4.3 Roster valuation
When a player’s price changes:
- **Grandfather**: User keeps them at acquisition price for cap purposes.
- **Revalue**: User’s roster is revalued at current prices (may force drops if over cap).

**Recommendation**: Grandfather – avoids forced drops and is more forgiving.

**Your choice**: Grandfather (but make it noticeable)

---

## 5. Season & Timing

### 5.1 Fantasy season alignment
- Match BuzzerBeater U21 season exactly (e.g. Season 71)?
- Or use custom dates?

**Your choice**: Match BuzzerBeater U21 season exactly

### 5.2 New players (call-ups)
- If a new player joins the U21 roster mid-season:
  - Add them with initial price (e.g. $5)?
  - Add them at $1?
  - Exclude from fantasy until next season?

**Recommendation**: Add with a default price (e.g. $5) or based on first game; allow subs to pick them up.

**Your choice**: Add with an approximated price (can use its DMI and Salary, and compare it to other players in the U21 team with the same position to approx it's price); allow subs to pick them up.

---

## 6. Scoring Formula (Optional Input)

We proposed a formula in PLAN.md. Do you want to:
- **Use our proposal** and validate with data
- **Prefer a simpler formula** (e.g. PTS + RTNG/2)
- **Prefer BuzzerBeater RTNG only** (no custom formula)

**Your choice**: **Use our proposal** and validate with data

---

## 7. Other

### 7.1 Number of users
- Private (friends only)?
- Public (anyone can join)?
- Single league or multiple leagues?

**Your choice**: Public (anyone can join), single league for now

### 7.2 Prizes / stakes
- Bragging rights only?
- Small prize pool?
- Purely casual?

**Your choice**: Casual

---

## Summary

Once you’ve answered, we’ll update PLAN.md and lessons.md with your decisions and proceed to Phase 1 implementation.
