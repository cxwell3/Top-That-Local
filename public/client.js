const socket = io();
let myId = null;

function code(c) {
  if (!c) return '';
  let v = c.value === 10 ? '0' : String(c.value);
  const suits = { hearts:'H', diamonds:'D', clubs:'C', spades:'S' };
  return v + suits[c.suit];
}

function makeImg(card = null, selectable = false, back = false) {
  const img = document.createElement('img');
  img.className = 'card-img';
  img.src = back
    ? 'https://deckofcardsapi.com/static/img/back.png'
    : `https://deckofcardsapi.com/static/img/${code(card)}.png`;
  if (selectable) {
    img.addEventListener('click', () => img.classList.toggle('selected'));
  }
  return img;
}

function renderRow(id, cards, sel = false, back = false) {
  const ctr = document.getElementById(id);
  ctr.innerHTML = '';
  cards.forEach(card => ctr.appendChild(makeImg(card, sel, back)));
}

function applyCardEffect(card) {
  const topCard = document.querySelector('#play-pile img:last-child');
  if (!topCard) return;

  topCard.classList.remove('effect-2', 'effect-5', 'effect-10');

  if (card.value === 2) {
    topCard.classList.add('effect-2');
  } else if (card.value === 5) {
    topCard.classList.add('effect-5');
  } else if (card.value === 10) {
    topCard.classList.add('effect-10');
  }

  setTimeout(() => {
    topCard.classList.remove('effect-2', 'effect-5', 'effect-10');
  }, 1500);
}

document.getElementById('sort-button').addEventListener('click', () => {
  const cards = document.querySelectorAll('#player-hand img');
  const sorted = Array.from(cards).sort((a, b) => a.src.localeCompare(b.src));
  const hand = document.getElementById('player-hand');
  hand.innerHTML = '';
  sorted.forEach(img => hand.appendChild(img));
});

// Example usage after play (integrate with your socket/game logic):
// applyCardEffect({ value: 10 }); // or 2, or 5
