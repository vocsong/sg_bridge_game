import logging
import os
import random
import string

from telegram import (InlineKeyboardButton, InlineKeyboardMarkup,
                      ReplyKeyboardMarkup, ReplyKeyboardRemove, Update)
from telegram.ext import ContextTypes

import bridge
import keyboards

logger = logging.getLogger(__name__)
PLAYERS = 4
MAX_BID = 34

# can be overridden via environment for different bot account names
BOT_USERNAME = os.getenv("BOT_USERNAME")

games = {}



async def _stop_game(context, chat_id):
    if chat_id not in games:
        return
    game = games[chat_id]
    if game["mode"] != "lobby":
        for i in range(PLAYERS):
            if game["hand_message_id"][i]:
                try:
                    await context.bot.edit_message_text(
                        chat_id=game["players_chat_id"][i],
                        message_id=game["hand_message_id"][i],
                        parse_mode="Markdown",
                        text="🃏 Game in _" + game["chat_title"] + "_ has ended! 🃏"
                    )
                except Exception:
                    pass
    try:
        await context.bot.edit_message_text(
            chat_id=chat_id,
            message_id=game["initial_message_id"],
            parse_mode="Markdown",
            text="Bridge game has ended!\n\n🃏 Use /start to start a new game 🃏"
        )
    except Exception:
        pass
    del games[chat_id]


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat

    if chat.type in ["group", "supergroup"]:
        if chat.id in games:
            await context.bot.send_message(
                chat_id=chat.id,
                reply_to_message_id=games[chat.id]["initial_message_id"],
                parse_mode="Markdown",
                text="❌ A game has already been started!"
            )
            return

        chars = string.ascii_letters + string.digits
        game_id = ''.join(random.choice(chars) for _ in range(10))
        while game_id in [g["game_id"] for g in games.values()]:
            game_id = ''.join(random.choice(chars) for _ in range(10))

        keyboard = [[InlineKeyboardButton("▶ Join game", url=f"https://t.me/{BOT_USERNAME}?start={game_id}")]]
        initial_message = await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=f"♣♦ *Bridge game started* ♥♠\n\n_Waiting for {PLAYERS} players to join..._",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

        games[chat.id] = {
            "game_id": game_id,
            "initial_message_id": initial_message.message_id,
            "chat_id": chat.id,
            "chat_title": chat.title,
            "players": [],
            "players_chat_id": [],
            "hand_message_id": [None] * PLAYERS,
            "mode": "lobby",
            "turn": 0,
            "bidder": -1,
            "bid": -1,
            "trump_suit": None,
            "hands": bridge.generate_hands(),
            "played_cards": [None] * PLAYERS,
            "sets": [0] * PLAYERS,
            "sets_needed": -1,
            "trump_broken": False,
            "first_player": False,
            "current_suit": None,
            "partner": -1,
            "partner_card": None,
        }

    elif chat.type == "private":
        game_id = context.args[0] if context.args else None
        game_chat_id = next((k for k, v in games.items() if v["game_id"] == game_id), None)

        if not game_id or game_chat_id is None:
            keyboard = [[InlineKeyboardButton("👥 Choose a group", url=f"https://t.me/{BOT_USERNAME}?startgroup=_")]]
            await update.message.reply_text(
                "Add me to a group to start playing! 🃏",
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
            return

        game = games[game_chat_id]

        if update.effective_user in game["players"]:
            await update.message.reply_text(
                parse_mode="Markdown",
                text="❌ You have already joined the game in _" + game["chat_title"] + "_!"
            )
            return

        if len(game["players"]) == PLAYERS:
            await update.message.reply_text(
                parse_mode="Markdown",
                text="❌ The game in _" + game["chat_title"] + "_ is already full!"
            )
            return

        game["players"].append(update.effective_user)
        game["players_chat_id"].append(chat.id)

        player_names = "\n".join("🃏 " + p.mention_markdown() for p in game["players"])

        await update.message.reply_text(
            parse_mode="Markdown",
            text="✅ Successfully joined game in _" + game["chat_title"] + "_!"
        )

        if len(game["players"]) < PLAYERS:
            kb = [[InlineKeyboardButton("▶ Join game", url=f"https://t.me/{BOT_USERNAME}?start={game_id}")]]
            await context.bot.edit_message_text(
                chat_id=game_chat_id,
                message_id=game["initial_message_id"],
                parse_mode="Markdown",
                text="♣♦ *Bridge game started* ♥♠\n\n*Players*\n" + player_names
                     + "\n\n_Waiting for " + str(PLAYERS - len(game["players"])) + " more player(s) to join..._",
                reply_markup=InlineKeyboardMarkup(kb)
            )
        else:
            await context.bot.edit_message_text(
                chat_id=game_chat_id,
                message_id=game["initial_message_id"],
                parse_mode="Markdown",
                text="♣♦ *Bridge game started* ♥♠\n\n*Players*\n" + player_names
                     + "\n\n✅ Game has begun! Check your PMs to see your cards."
            )
            game["mode"] = "bid"
            keyboard = keyboards.bid_keyboard()

            for i in range(PLAYERS):
                hand_message = await context.bot.send_message(
                    chat_id=game["players_chat_id"][i],
                    parse_mode="Markdown",
                    text="🃏 *Your hand* 🃏\n(for _" + game["chat_title"] + "_)\n\n"
                         + str(game["sets"][i]) + " set(s) 👑 won\n\n"
                         + bridge.generate_hand_string(game["hands"][i])
                )
                game["hand_message_id"][i] = hand_message.message_id

            await context.bot.send_message(
                chat_id=game_chat_id,
                parse_mode="Markdown",
                text=game["players"][0].mention_markdown() + ", start the bid!",
                reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
            )


async def stop(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    if chat.type not in ["group", "supergroup"] or chat.id not in games:
        await update.message.reply_text(
            parse_mode="Markdown",
            text="❌ No game has been started!\n\nUse /start to start a new game 🃏"
        )
        return

    game = games[chat.id]
    kb = [[InlineKeyboardButton("✅ Stop game", callback_data="stop")],
          [InlineKeyboardButton("❌ Cancel", callback_data="cancel")]]
    await context.bot.send_message(
        chat_id=chat.id,
        parse_mode="Markdown",
        reply_to_message_id=game["initial_message_id"],
        text="⚠ Are you sure you want to stop this bridge game?",
        reply_markup=InlineKeyboardMarkup(kb)
    )


async def inline_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    chat_id = query.message.chat_id
    await query.answer()

    if query.data == "stop":
        if chat_id not in games:
            return
        await _stop_game(context, chat_id)
        await query.edit_message_text(text="The game has been stopped successfully ⛔")

    elif query.data == "cancel":
        await query.edit_message_text(text="This game will continue! 🃏")


async def bid(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    if chat.type not in ["group", "supergroup"] or chat.id not in games:
        return

    game = games[chat.id]

    if game["mode"] in ["partner", "play"]:
        msg = update.message.text
        arg_list = msg.split()
        is_card = (msg == "▪"
                   or len(arg_list) == 2
                   and (arg_list[0].isdigit() and 2 <= int(arg_list[0]) <= 10
                        or arg_list[0] in ["A", "K", "Q", "J"])
                   and arg_list[1] in bridge.CARD_SUITS)
        if is_card:
            await card(update, context)
        return

    if game["mode"] != "bid":
        return
    if update.effective_user != game["players"][game["turn"]]:
        return

    text = update.message.text

    if text == "⏭ Pass!":
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=update.effective_user.mention_markdown() + " *passed* ⏭ this turn",
            reply_markup=ReplyKeyboardRemove()
        )

    elif text == "▪":
        keyboard = keyboards.bid_keyboard(game["bid"])
        current = ("*Current bid:* " + game["players"][game["bidder"]].full_name
                   + " - " + bridge.get_bid_from_num(game["bid"])
                   if game["bidder"] >= 0 else "")
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=current + "\n\n" + game["players"][game["turn"]].mention_markdown() + ", it's your turn to bid!",
            reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
        )
        return

    else:
        bid_num = bridge.get_num_from_bid(text)
        if bid_num <= game["bid"] or bid_num > MAX_BID:
            return
        game["bid"] = bid_num
        game["trump_suit"] = text[2]
        game["sets_needed"] = int(text[0]) + 6
        game["bidder"] = game["turn"]
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=update.effective_user.mention_markdown() + " bidded *" + text + "*",
            reply_markup=ReplyKeyboardRemove()
        )

    game["turn"] = (game["turn"] + 1) % PLAYERS

    if game["bidder"] == game["turn"] or game["bid"] == MAX_BID:
        if game["bidder"] < 0:
            game["hands"] = bridge.generate_hands()
            game["turn"] = 0
            keyboard = keyboards.bid_keyboard()
            await context.bot.send_message(
                chat_id=chat.id,
                parse_mode="Markdown",
                text="All passed! Redealing...\n" + game["players"][0].mention_markdown() + ", start the bid!",
                reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
            )
            return

        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=game["players"][game["bidder"]].mention_markdown()
                 + ", you have won the bid 🌟 of *" + bridge.get_bid_from_num(game["bid"]) + "*!\n\n"
                 + "You and your partner need a total of *" + str(game["sets_needed"]) + " sets* 👑 to win",
            reply_markup=ReplyKeyboardRemove()
        )
        game["mode"] = "partner"
        game["turn"] = game["bidder"]
        keyboard = keyboards.partner_keyboard()
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=game["players"][game["bidder"]].mention_markdown() + ", choose your partner 👥",
            reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
        )
    else:
        keyboard = keyboards.bid_keyboard(game["bid"])
        current = ("*Current bid:* " + game["players"][game["bidder"]].full_name
                   + " - " + bridge.get_bid_from_num(game["bid"])
                   if game["bidder"] >= 0 else "")
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=current + "\n\n" + game["players"][game["turn"]].mention_markdown() + ", it's your turn to bid!",
            reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
        )


async def card(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    if chat.type not in ["group", "supergroup"] or chat.id not in games:
        return

    game = games[chat.id]

    if (game["mode"] == "partner"
            and update.effective_user == game["players"][game["turn"]]):

        partner_card = update.message.text.split()
        game["partner_card"] = update.message.text
        game["partner"] = -1

        for i in range(PLAYERS):
            if partner_card[0] in game["hands"][i][partner_card[1]]:
                game["partner"] = i
                break

        partner = game["partner"]
        bidder = game["bidder"]

        if partner == bidder:
            await context.bot.send_message(
                chat_id=game["players_chat_id"][partner],
                parse_mode="Markdown",
                text="💬 Psst... you picked *yourself* as partner 👥 !"
            )
        elif partner < PLAYERS:
            await context.bot.send_message(
                chat_id=game["players_chat_id"][partner],
                parse_mode="Markdown",
                text="💬 Psst... you are *" + game["players"][bidder].full_name + "'s* partner 👥 !"
            )
        else:
            await context.bot.send_message(
                chat_id=game["players_chat_id"][game["turn"]],
                parse_mode="Markdown",
                text="⚠ The partner card you picked isn't held by any player (" + str(partner) + ")"
            )
            game["partner"] = partner = bidder

        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=update.effective_user.mention_markdown() + "'s partner 👥 is *" + update.message.text + "*",
            reply_markup=ReplyKeyboardRemove()
        )

        game["mode"] = "play"

        if game["trump_suit"] == "🚫":
            hand = game["hands"][game["bidder"]]
            keyboard = keyboards.hand_keyboard(hand)
            game["first_player"] = game["turn"]
            await context.bot.send_message(
                chat_id=chat.id,
                parse_mode="Markdown",
                text="Winning bid is *No Trump* 🚫:\nBidder, " + update.effective_user.mention_markdown() + ", will start",
                reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
            )
        else:
            game["turn"] = (game["turn"] + 1) % PLAYERS
            game["first_player"] = game["turn"]
            hand = game["hands"][game["turn"]]
            valid_suits = bridge.get_valid_suits(hand, trump_suit=game["trump_suit"])
            keyboard = keyboards.hand_keyboard(hand, valid_suits)
            await context.bot.send_message(
                chat_id=chat.id,
                parse_mode="Markdown",
                text=game["players"][game["turn"]].mention_markdown() + " will start",
                reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
            )
        return

    if (game["mode"] != "play"
            or update.effective_user != game["players"][game["turn"]]):
        return

    turn = game["turn"]
    first_player = game["first_player"]
    trump_suit = game["trump_suit"]
    trump_broken = game["trump_broken"]
    current_suit = game["current_suit"]
    current_card = update.message.text.split()
    hand = game["hands"][turn]
    valid_suits = bridge.get_valid_suits(hand, trump_suit=trump_suit, current_suit=current_suit, trump_broken=trump_broken)

    if current_card[0] == "▪":
        keyboard = keyboards.hand_keyboard(hand, valid_suits)
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text="❌ " + game["players"][turn].mention_markdown() + ", that was an invalid card... Pick again!",
            reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
        )
        return

    if not (current_card[1] in valid_suits and current_card[0] in game["hands"][turn][current_card[1]]):
        return

    game["played_cards"][turn] = update.message.text
    game["hands"][turn][current_card[1]].remove(current_card[0])

    await context.bot.edit_message_text(
        chat_id=game["players_chat_id"][turn],
        message_id=game["hand_message_id"][turn],
        parse_mode="Markdown",
        text="🃏 *Your hand* 🃏\n(for _" + game["chat_title"] + "_)\n\n"
             + str(game["sets"][turn]) + " set(s) 👑 won\n\n"
             + bridge.generate_hand_string(game["hands"][turn])
    )

    if first_player == turn:
        game["current_suit"] = current_suit = current_card[1]

    if current_card[1] == trump_suit:
        game["trump_broken"] = True
        trump_broken = True

    game["turn"] = (game["turn"] + 1) % PLAYERS
    turn = game["turn"]

    played_cards_string_list = []
    for i in range(first_player, first_player + PLAYERS):
        i %= PLAYERS
        played_cards_string_list.append("\n")
        played_cards_string_list.append("❇️ " if i == game["turn"] and not game["played_cards"][i] else "🃏 ")
        played_cards_string_list.append(game["players"][i].full_name)
        played_cards_string_list.append(" (" + str(game["sets"][i]) + " 👑) - ")
        played_cards_string_list.append(game["played_cards"][i] if game["played_cards"][i] else "▪")

    await context.bot.send_message(
        chat_id=chat.id,
        parse_mode="Markdown",
        text="🌟 *Bid:* " + game["players"][game["bidder"]].full_name
             + " - " + bridge.get_bid_from_num(game["bid"])
             + "\n👥 *Partner:* " + game["partner_card"]
             + "\n" + "".join(played_cards_string_list),
        reply_markup=ReplyKeyboardRemove()
    )

    if turn == first_player:
        winner = bridge.compare_cards(game["played_cards"], current_suit, trump_suit=trump_suit)
        game["sets"][winner] += 1
        game["turn"] = winner
        game["first_player"] = winner
        game["current_suit"] = None
        game["played_cards"] = [None] * PLAYERS

        bidder = game["bidder"]
        partner = game["partner"]
        sets = game["sets"]
        sets_needed = game["sets_needed"]
        bidder_sets = sets[bidder] if partner == bidder else sets[bidder] + sets[partner]

        if bidder_sets == sets_needed:
            await context.bot.send_message(
                chat_id=chat.id, parse_mode="Markdown",
                text=game["players"][winner].mention_markdown()
                     + ", you have won this set 👑 !\n\nYou now have *" + str(game["sets"][winner]) + " set(s)* 👑\n\n"
            )
            if bidder == partner:
                await context.bot.send_message(
                    chat_id=chat.id, parse_mode="Markdown",
                    text="🏅 The bidder, " + game["players"][bidder].mention_markdown()
                         + ", has won the game alone! 🏅\n\nUse /start to start a new game 🃏"
                )
            else:
                await context.bot.send_message(
                    chat_id=chat.id, parse_mode="Markdown",
                    text="🏅 The bidder, " + game["players"][bidder].mention_markdown()
                         + ", and partner, " + game["players"][partner].mention_markdown()
                         + ", have won the game! 🏅\n\nUse /start to start a new game 🃏"
                )
            await _stop_game(context, chat.id)
            return

        elif sum(sets) - bidder_sets == 14 - sets_needed:
            winner_list = [game["players"][i].mention_markdown()
                           for i in range(PLAYERS) if i != partner and i != bidder]
            winner_string = (winner_list[0] + ", " + winner_list[1] + " and " + winner_list[2]
                             if len(winner_list) == 3 else " and ".join(winner_list))
            await context.bot.send_message(
                chat_id=chat.id, parse_mode="Markdown",
                text=game["players"][winner].mention_markdown()
                     + ", you have won this set 👑 !\n\nYou now have *" + str(game["sets"][winner]) + " set(s)* 👑\n\n"
            )
            await context.bot.send_message(
                chat_id=chat.id, parse_mode="Markdown",
                text="🏅 " + winner_string + " have won the game! 🏅\n\nUse /start to start a new game 🃏"
            )
            await _stop_game(context, chat.id)
            return

        winner_hand = game["hands"][winner]
        valid_suits = bridge.get_valid_suits(winner_hand, trump_suit=trump_suit, trump_broken=trump_broken)
        keyboard = keyboards.hand_keyboard(winner_hand, valid_suits)
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=game["players"][winner].mention_markdown()
                 + ", you have won this set 👑 !\n\nYou now have *" + str(game["sets"][winner])
                 + " set(s)* 👑\n\nPick a card to start the next set!",
            reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
        )
    else:
        next_hand = game["hands"][turn]
        valid_suits = bridge.get_valid_suits(next_hand, trump_suit=trump_suit, trump_broken=trump_broken, current_suit=current_suit)
        keyboard = keyboards.hand_keyboard(next_hand, valid_suits)
        await context.bot.send_message(
            chat_id=chat.id,
            parse_mode="Markdown",
            text=game["players"][turn].mention_markdown() + ", it's your turn ❇️ !",
            reply_markup=ReplyKeyboardMarkup(keyboard, selective=True, one_time_keyboard=True, resize_keyboard=True)
        )
