// @ts-nocheck
import { ensureAnonymousUser, supabase } from './supabase.js';

function requireClient() {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Abrí src/lib/supabase-config.js.'
    );
  }

  return supabase;
}

function readableError(error) {
  if (!error) {
    return 'Ocurrió un error desconocido.';
  }

  return error.message?.replace(/^.*?exception:\s*/i, '') ?? String(error);
}

async function rpc(name, params = {}) {
  const client = requireClient();

  const { data, error } = await client.rpc(name, params);

  if (error) {
    throw new Error(readableError(error));
  }

  return data;
}

export async function initializeUser() {
  return ensureAnonymousUser();
}

export async function createRoom(name, gridSize, timerEnabled) {
  const data = await rpc('create_room', {
    p_name: name,
    p_grid_size: Number(gridSize),
    p_timer_enabled: Boolean(timerEnabled)
  });

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.room_id) {
    throw new Error('No se pudo crear la sala.');
  }

  return result;
}

export async function joinRoom(code, name) {
  return rpc('join_room', {
    p_code: code,
    p_name: name
  });
}

export async function leaveRoom(roomId) {
  await rpc('leave_room', {
    p_room_id: roomId
  });
}

export async function updateRoomSettings(
  roomId,
  gridSize,
  timerEnabled
) {
  await rpc('update_room_settings', {
    p_room_id: roomId,
    p_grid_size: Number(gridSize),
    p_timer_enabled: Boolean(timerEnabled)
  });
}

export async function startGame(roomId) {
  await rpc('start_game', {
    p_room_id: roomId
  });
}

export async function submitClue(cardId, clue) {
  await rpc('submit_clue', {
    p_card_id: cardId,
    p_clue: clue
  });
}

export async function submitGuess(cardId, row, col) {
  return rpc('submit_guess', {
    p_card_id: cardId,
    p_selected_row: Number(row),
    p_selected_col: Number(col)
  });
}

export async function syncGame(roomId) {
  return rpc('sync_game', {
    p_room_id: roomId
  });
}

export async function touchPlayer(roomId) {
  await rpc('touch_player', {
    p_room_id: roomId
  });
}

export async function loadSnapshot(roomId, userId) {
  const client = requireClient();

  const { data: room, error: roomError } = await client
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();

  if (roomError) {
    throw new Error(readableError(roomError));
  }

  if (!room) {
    throw new Error(
      'La sala ya no existe o no pertenecés a ella.'
    );
  }

  const [
    playersResult,
    cardsResult,
    targetsResult,
    guessesResult
  ] = await Promise.all([
    client
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true }),

    client
      .from('clue_cards')
      .select('*')
      .eq('room_id', roomId)
      .order('draw_order', { ascending: true }),

    client
      .from('card_targets')
      .select('*')
      .eq('room_id', roomId),

    client
      .from('guesses')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
  ]);

  if (playersResult.error) {
    throw new Error(readableError(playersResult.error));
  }

  if (cardsResult.error) {
    throw new Error(readableError(cardsResult.error));
  }

  if (targetsResult.error) {
    throw new Error(readableError(targetsResult.error));
  }

  if (guessesResult.error) {
    throw new Error(readableError(guessesResult.error));
  }

  const players = playersResult.data ?? [];

  return {
    room,
    players,
    currentPlayer:
      players.find((player) => player.user_id === userId) ?? null,
    cards: cardsResult.data ?? [],
    targets: targetsResult.data ?? [],
    guesses: guessesResult.data ?? []
  };
}

export function subscribeToRoom(roomId, onChange) {
  const client = requireClient();

  let timer;

  const changed = () => {
    clearTimeout(timer);

    timer = setTimeout(() => {
      onChange();
    }, 100);
  };

  const channel = client
    .channel(`room-${roomId}-${crypto.randomUUID()}`)

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`
      },
      changed
    )

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'players',
        filter: `room_id=eq.${roomId}`
      },
      changed
    )

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'clue_cards',
        filter: `room_id=eq.${roomId}`
      },
      changed
    )

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'guesses',
        filter: `room_id=eq.${roomId}`
      },
      changed
    )

    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' && error) {
        console.error('Error de Realtime:', error);
      }
    });

  return () => {
    clearTimeout(timer);
    client.removeChannel(channel);
  };
}