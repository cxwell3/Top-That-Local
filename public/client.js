/* ------------------------------------------------------------------
   Three’s Card Game – Browser client
   ------------------------------------------------------------------ */

const socket = io();
let myId = null;

/* ---------- quick DOM helper ---------- */
const $ = id => document.getElementById(id);

/* ---------- element refs ---------- */
const nameIn   = $('name');
const joinBtn  = $('join');
const table    = $('table');

const myName   = $('my-name');
const myHand   = $('my-hand');
const playBtn  = $('play');
const takeBtn  = $('take');

const otherDiv = $('other-players');

const playPile   = $('play-pile');
const drawPile   = $('draw-pile');
const discardPile= $('discard-pile');

/* ---------- utility ---------- */
function code(c) {
  if (!c) return '';
  const v = c.value === 10 ? '0' : String(c.value).toUpperCase();
  const suits = { hearts:'H', diamonds:'D', clubs:'C', spades:'S' };
  return v + suits[c.suit];
}

function cardImg(card, selectable = false) {
  const img = new Image();
  img.className = 'card-img';
  img.src = card
