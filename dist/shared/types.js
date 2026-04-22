import { z } from "zod";
export const ClientEventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("create_room"), payload: z.object({ name: z.string().min(1) }) }),
    z.object({
        type: z.literal("join_room"),
        payload: z.object({ roomId: z.string().min(1), name: z.string().min(1) })
    }),
    z.object({
        type: z.literal("update_deck"),
        payload: z.object({
            /** 玩家选择的牌库 */
            deck: z.array(z.object({
                id: z.string(),
                name: z.string(),
                type: z.string(),
                cost: z.union([z.string(), z.number()]),
                keyword: z.string().optional(),
                ability: z.string().optional(),
                img: z.string().optional(),
                attack: z.number().optional(),
                health: z.number().optional()
            }))
        })
    }),
    z.object({
        type: z.literal("start_match"),
        payload: z.object({ roomId: z.string().min(1) })
    }),
    z.object({
        type: z.literal("submit_mulligan"),
        payload: z.object({
            roomId: z.string().min(1),
            /** 要暂置并洗回牌库的手牌 id；可空数组表示不换牌 */
            cardIds: z.array(z.string().min(1))
        })
    }),
    z.object({
        type: z.literal("play_card"),
        payload: z.object({
            roomId: z.string().min(1),
            cardId: z.string().min(1),
            targetPlayerId: z.string().min(1),
            zone: z.enum(["shikigami", "spell"])
        })
    }),
    z.object({
        type: z.literal("toggle_spell_exhaust"),
        payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1) })
    }),
    z.object({
        type: z.literal("toggle_shikigami_exhaust"),
        payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1) })
    }),
    z.object({
        type: z.literal("attack"),
        payload: z.object({
            roomId: z.string().min(1),
            attackerCardId: z.string().min(1),
            targetPlayerId: z.string().min(1),
            target: z.enum(["player", "shikigami"]),
            targetCardId: z.string().optional()
        })
    }),
    z.object({ type: z.literal("end_turn"), payload: z.object({ roomId: z.string().min(1) }) }),
    z.object({
        type: z.literal("move_card"),
        payload: z.object({
            roomId: z.string().min(1),
            cardId: z.string().min(1),
            from: z.enum(["hand", "graveyard", "spell", "shikigami", "barrier", "deck_top", "deck_search", "removed_zone", "extend", "showcase"]),
            to: z.enum(["hand", "graveyard", "spell", "shikigami", "barrier", "deck_top", "deck_bottom", "removed_zone", "extend", "showcase"]),
            /** 放入己方式神区时的座位 0–5，省略则找第一个空位 */
            toShikigamiSlot: z.number().int().min(0).max(5).optional()
        })
    }),
    z.object({
        type: z.literal("toggle_spell_reveal"),
        payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1) })
    }),
    z.object({
        type: z.literal("toggle_hand_reveal"),
        payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1), reveal: z.boolean() })
    }),
    z.object({
        type: z.literal("deck_draw"),
        payload: z.object({ roomId: z.string().min(1), count: z.number().int().min(1).max(10).optional() })
    }),
    z.object({ type: z.literal("deck_shuffle"), payload: z.object({ roomId: z.string().min(1) }) }),
    z.object({
        type: z.literal("deck_search"),
        payload: z.object({ roomId: z.string().min(1), count: z.number().int().min(1).max(60) })
    }),
    z.object({
        type: z.literal("deck_peek"),
        payload: z.object({ roomId: z.string().min(1), count: z.number().int().min(1).max(60) })
    }),
    z.object({
        type: z.literal("place_shikigami_token"),
        payload: z.object({
            roomId: z.string().min(1),
            /** 式神所属玩家（可为己方或对方） */
            targetPlayerId: z.string().min(1),
            slotIndex: z.number().int().min(0).max(5),
            tokenKind: z.enum(["attack_plus", "attack_minus", "health_plus", "health_minus", "damage", "energy", "barrier", "stun"])
        })
    }),
    z.object({
        type: z.literal("remove_shikigami_token"),
        payload: z.object({
            roomId: z.string().min(1),
            targetPlayerId: z.string().min(1),
            slotIndex: z.number().int().min(0).max(5),
            tokenKind: z.enum(["attack_plus", "attack_minus", "health_plus", "health_minus", "damage", "energy", "barrier", "stun"])
        })
    }),
    z.object({
        type: z.literal("adjust_player_hp"),
        payload: z.object({
            roomId: z.string().min(1),
            /** 增加或减少的生命值（可为负） */
            delta: z.number().int()
        })
    })
]);
