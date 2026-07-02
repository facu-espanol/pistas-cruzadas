<script>
  // @ts-nocheck
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { isSupabaseConfigured } from '$lib/supabase.js';
  import {
    createRoom,
    initializeUser,
    joinRoom,
    leaveRoom,
    loadSnapshot,
    startGame,
    submitClue,
    submitGuess,
    subscribeToRoom,
    syncGame,
    touchPlayer,
    updateRoomSettings
  } from '$lib/game.js';

  const letters = 'ABCDE';

  let user = null;
  let snapshot = null;
  let currentRoomId = '';
  let loading = true;
  let actionLoading = false;
  let answerSending = false;
  let timerSyncing = false;
  let error = '';
  let notice = '';
  let unsubscribe = null;
  let heartbeat = null;
  let clock = null;
  let now = Date.now();

  let name = '';
  let joinCode = '';
  let createGridSize = 4;
  let createTimerEnabled = true;
  let lobbyGridSize = 4;
  let lobbyTimerEnabled = true;
  let selectedCardId = '';
  let clueText = '';
  let confirmedCell = null;

  $: room = snapshot?.room ?? null;
  $: players = snapshot?.players ?? [];
  $: currentPlayer = snapshot?.currentPlayer ?? null;
  $: cards = snapshot?.cards ?? [];
  $: targets = snapshot?.targets ?? [];
  $: guesses = snapshot?.guesses ?? [];
  $: isHost = Boolean(room && user && room.host_user_id === user.id);
  $: activeCard = cards.find((card) => card.id === room?.active_card_id) ?? null;
  $: activeGiver = players.find((player) => player.id === activeCard?.owner_player_id) ?? null;
  $: isActiveGiver = Boolean(currentPlayer && activeCard?.owner_player_id === currentPlayer.id);
  $: canAnswer = Boolean(room?.status === 'playing' && activeCard && !isActiveGiver);
  $: ownHandCards = cards.filter(
    (card) => card.owner_player_id === currentPlayer?.id && card.status === 'hand'
  );
  $: selectedCard = ownHandCards.find((card) => card.id === selectedCardId) ?? null;
  $: correctCards = cards.filter((card) => card.status === 'correct');
  $: discardedCards = cards.filter((card) => card.status === 'discarded');
  $: deckCount = cards.filter((card) => card.status === 'deck').length;
  $: cardsInHands = cards.filter((card) => card.status === 'hand').length;
  $: totalCards = room ? room.grid_size * room.grid_size : 0;
  $: lastGuess = guesses[0] ?? null;
  $: lastResolvedCard = cards.find((card) => card.id === lastGuess?.card_id) ?? null;
  $: secondsLeft = room?.ends_at
    ? Math.max(0, Math.ceil((new Date(room.ends_at).getTime() - now) / 1000))
    : null;

  onMount(() => {
    boot();
    clock = setInterval(tickClock, 1000);

    return () => {
      unsubscribe?.();
      clearInterval(heartbeat);
      clearInterval(clock);
    };
  });

  async function boot() {
    loading = true;
    error = '';

    try {
      const params = new URLSearchParams(window.location.search);
      joinCode = (params.get('sala') ?? '').toUpperCase().slice(0, 5);
      name = localStorage.getItem('pc_name') ?? '';

      if (!isSupabaseConfigured) return;

      user = await initializeUser();
      const savedRoomId = localStorage.getItem('pc_room_id');

      if (savedRoomId && !joinCode) {
        try {
          await attachRoom(savedRoomId);
        } catch (restoreError) {
          console.warn('No se pudo recuperar la sala:', restoreError);
          localStorage.removeItem('pc_room_id');
          snapshot = null;
          currentRoomId = '';
        }
      }
    } catch (bootError) {
      error = bootError.message;
    } finally {
      loading = false;
    }
  }

  async function attachRoom(roomId) {
    unsubscribe?.();
    clearInterval(heartbeat);

    currentRoomId = roomId;
    localStorage.setItem('pc_room_id', roomId);
    await refresh();

    unsubscribe = subscribeToRoom(roomId, refreshQuietly);
    await touchPlayer(roomId);
    heartbeat = setInterval(() => touchPlayer(roomId).catch(console.error), 45_000);
  }

  async function refresh() {
    if (!currentRoomId || !user) return;

    const fresh = await loadSnapshot(currentRoomId, user.id);
    snapshot = fresh;

    if (
      confirmedCell &&
      !fresh.cards.some((card) => card.id === confirmedCell.cardId && card.status === 'correct')
    ) {
      confirmedCell = null;
    }

    const freshHand = fresh.cards.filter(
      (card) => card.owner_player_id === fresh.currentPlayer?.id && card.status === 'hand'
    );

    if (!freshHand.some((card) => card.id === selectedCardId)) {
      selectedCardId = freshHand[0]?.id ?? '';
      clueText = '';
    }

    if (fresh.room.status === 'lobby') {
      lobbyGridSize = fresh.room.grid_size;
      lobbyTimerEnabled = fresh.room.timer_enabled;
    }
  }

  function refreshQuietly() {
    refresh().catch((refreshError) => {
      console.error(refreshError);
      error = refreshError.message;
    });
  }

  async function tickClock() {
    now = Date.now();

    if (
      room?.status === 'playing' &&
      room.ends_at &&
      new Date(room.ends_at).getTime() <= now &&
      !timerSyncing
    ) {
      timerSyncing = true;
      try {
        await syncGame(room.id);
        await refresh();
      } catch (syncError) {
        console.error(syncError);
      } finally {
        timerSyncing = false;
      }
    }
  }

  async function runAction(callback, successMessage = '') {
    actionLoading = true;
    error = '';
    notice = '';

    try {
      await callback();
      if (successMessage) notice = successMessage;
    } catch (actionError) {
      error = actionError.message;
    } finally {
      actionLoading = false;
    }
  }

  async function handleCreate() {
    const cleanName = name.trim();

    await runAction(async () => {
      const result = await createRoom(cleanName, createGridSize, createTimerEnabled);
      name = cleanName;
      localStorage.setItem('pc_name', cleanName);
      await attachRoom(result.room_id);
    });
  }

  async function handleJoin() {
    const cleanName = name.trim();
    const cleanCode = joinCode.trim().toUpperCase();

    await runAction(async () => {
      const roomId = await joinRoom(cleanCode, cleanName);
      name = cleanName;
      joinCode = cleanCode;
      localStorage.setItem('pc_name', cleanName);
      await attachRoom(roomId);
    });
  }

  async function handleLeaveLobby() {
    await runAction(async () => {
      await leaveRoom(room.id);
      exitToHome();
    });
  }

  function exitToHome() {
    unsubscribe?.();
    unsubscribe = null;
    clearInterval(heartbeat);
    heartbeat = null;
    localStorage.removeItem('pc_room_id');
    snapshot = null;
    currentRoomId = '';
    selectedCardId = '';
    clueText = '';
    history.replaceState({}, '', `${base || ''}/`);
  }

  async function saveSettings() {
    await runAction(async () => {
      await updateRoomSettings(room.id, lobbyGridSize, lobbyTimerEnabled);
      await refresh();
    }, 'Configuración actualizada.');
  }

  async function handleStart() {
    await runAction(async () => {
      await startGame(room.id);
      await refresh();
    });
  }

  async function handleClue() {
    if (!selectedCard) {
      error = 'No tenés una tarjeta disponible.';
      return;
    }

    await runAction(async () => {
      await submitClue(selectedCard.id, clueText);
      clueText = '';
      await refresh();
    });
  }

  async function answerCell(rowIndex, colIndex) {
    if (!canAnswer || answerSending || !activeCard || correctCardAt(rowIndex, colIndex)) return;

    answerSending = true;
    error = '';
    notice = '';

    try {
      const wasCorrect = await submitGuess(activeCard.id, rowIndex, colIndex);
      confirmedCell = wasCorrect
        ? { cardId: activeCard.id, row: Number(rowIndex), col: Number(colIndex), clue: activeCard.clue }
        : null;
      notice = wasCorrect
        ? `¡Correcto! ${coordinate(rowIndex, colIndex)} queda en la grilla.`
        : `No era ${coordinate(rowIndex, colIndex)}. La tarjeta se descartó.`;
      await refresh();
    } catch (answerError) {
      error = answerError.message;
      await refresh().catch(console.error);
    } finally {
      answerSending = false;
    }
  }

  async function handleRestart() {
    await runAction(async () => {
      await startGame(room.id);
      await refresh();
    });
  }

  async function copyInvite() {
    const url = `${window.location.origin}${base || ''}/?sala=${room.code}`;

    try {
      await navigator.clipboard.writeText(url);
      notice = 'Enlace de invitación copiado.';
    } catch {
      notice = `Compartí este enlace: ${url}`;
    }
  }

  function coordinate(rowIndex, colIndex) {
    return `${letters[colIndex]}${rowIndex + 1}`;
  }

  function targetFor(cardId) {
    return targets.find((target) => target.card_id === cardId) ?? null;
  }

  function rowWord(target) {
    return target ? room?.row_words?.[target.target_row] ?? '—' : '—';
  }

  function columnWord(target) {
    return target ? room?.column_words?.[target.target_col] ?? '—' : '—';
  }

  function solvedCardAt(rowIndex, colIndex) {
    if (
      confirmedCell &&
      confirmedCell.row === Number(rowIndex) &&
      confirmedCell.col === Number(colIndex)
    ) {
      return {
        id: confirmedCell.cardId,
        clue: confirmedCell.clue ?? 'Acertada'
      };
    }

    const correctGuess = guesses.find(
      (guess) =>
        guess.is_correct === true &&
        Number(guess.selected_row) === Number(rowIndex) &&
        Number(guess.selected_col) === Number(colIndex)
    );

    if (!correctGuess) return null;

    const card = cards.find((candidate) => candidate.id === correctGuess.card_id);

    return {
      id: correctGuess.card_id,
      clue: card?.clue ?? 'Acertada'
    };
  }

  function correctCardAt(rowIndex, colIndex) {
    const solvedFromGuess = solvedCardAt(rowIndex, colIndex);
    if (solvedFromGuess) return solvedFromGuess;

    const solvedTarget = targets.find(
      (target) =>
        Number(target.target_row) === Number(rowIndex) &&
        Number(target.target_col) === Number(colIndex) &&
        cards.some((card) => card.id === target.card_id && card.status === 'correct')
    );

    if (!solvedTarget) return null;

    const card = cards.find((candidate) => candidate.id === solvedTarget.card_id);

    return {
      id: solvedTarget.card_id,
      clue: card?.clue ?? 'Acertada'
    };
  }

  function playerName(playerId) {
    return players.find((player) => player.id === playerId)?.display_name ?? 'Jugador';
  }

  function isOnline(player) {
    return now - new Date(player.last_seen).getTime() < 100_000;
  }

  function formatTime(seconds) {
    if (seconds === null) return 'Sin reloj';
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  function scoreLevel(size, score) {
    if (size === 3) {
      if (score < 4) return ['Fallido', 'Todavía no se entienden demasiado.'];
      if (score < 6) return ['Promedio', 'Ya empiezan a conectar ideas.'];
      if (score < 8) return ['Bueno', 'Tienen una conexión fuerte.'];
      return ['Asombroso', '¡Están conectados telepáticamente!'];
    }

    if (size === 4) {
      if (score < 8) return ['Fallido', 'Todavía no se entienden demasiado.'];
      if (score < 12) return ['Promedio', 'Ya empiezan a conectar ideas.'];
      if (score < 15) return ['Bueno', 'Tienen una conexión fuerte.'];
      return ['Asombroso', '¡Están conectados telepáticamente!'];
    }

    if (score < 12) return ['Fallido', 'Todavía no se entienden demasiado.'];
    if (score < 17) return ['Promedio', 'Ya empiezan a conectar ideas.'];
    if (score < 23) return ['Bueno', 'Tienen una conexión fuerte.'];
    return ['Asombroso', '¡Están conectados telepáticamente!'];
  }
</script>

<svelte:head>
  <title>Pistas Cruzadas Online</title>
  <link rel="icon" href={`${base}/favicon.svg`} />
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <button class="brand" on:click={() => room?.status === 'finished' && exitToHome()}>
      <span class="brand-grid" aria-hidden="true">✣</span>
      <span>
        <strong>Pistas Cruzadas</strong>
        <small>Online</small>
      </span>
    </button>

    {#if room}
      <div class="room-badge">Sala <strong>{room.code}</strong></div>
    {/if}
  </header>

  <main>
    {#if loading}
      <section class="center-card compact-center">
        <div class="spinner" aria-hidden="true"></div>
        <h1>Preparando el juego…</h1>
      </section>
    {:else if !isSupabaseConfigured}
      <section class="center-card compact-center">
        <span class="eyebrow">Falta un paso</span>
        <h1>Conectá tu proyecto de Supabase</h1>
        <p>
          Completá <code>src/lib/supabase-config.js</code> y ejecutá
          <code>supabase/setup.sql</code> en el SQL Editor.
        </p>
      </section>
    {:else if !room}
      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow">Cooperativo y en tiempo real</span>
          <h1>Todos piensan.<br />Alguien da una pista.<br />Una respuesta decide.</h1>
          <p>
            No hay turnos ni votaciones. Cada participante recibe coordenadas secretas,
            piensa una pista de una sola palabra y puede decirla apenas esté listo.
          </p>
        </div>

        <div class="home-panel">
          <label>
            Tu nombre
            <input bind:value={name} maxlength="20" placeholder="Ejemplo: Facu" />
          </label>

          <div class="option-grid">
            <label>
              Grilla
              <select bind:value={createGridSize}>
                <option value={3}>Rápida 3×3</option>
                <option value={4}>Clásica 4×4</option>
                <option value={5}>Experta 5×5</option>
              </select>
            </label>

            <label class="toggle-card">
              <input type="checkbox" bind:checked={createTimerEnabled} />
              <span>
                <strong>Usar reloj</strong>
                <small>{createGridSize === 5 ? '10 minutos' : '5 minutos'}</small>
              </span>
            </label>
          </div>

          <button class="primary full" disabled={actionLoading || name.trim().length < 2} on:click={handleCreate}>
            Crear sala
          </button>

          <div class="divider"><span>o entrar a una existente</span></div>

          <div class="join-row">
            <input
              class="code-input"
              bind:value={joinCode}
              maxlength="5"
              placeholder="CÓDIGO"
              on:input={() => (joinCode = joinCode.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
            />
            <button
              class="secondary"
              disabled={actionLoading || name.trim().length < 2 || joinCode.length !== 5}
              on:click={handleJoin}
            >
              Entrar
            </button>
          </div>
        </div>
      </section>
    {:else if room.status === 'lobby'}
      <section class="lobby-layout">
        <div>
          <span class="eyebrow">Sala de espera</span>
          <h1>Invitá al equipo</h1>
          <p class="lead">Pistas Cruzadas se juega de 2 a 6 personas.</p>

          <div class="invite-card card">
            <div>
              <small>Código de sala</small>
              <strong>{room.code}</strong>
            </div>
            <button class="secondary" on:click={copyInvite}>Copiar enlace</button>
          </div>

          <div class="rules-card card">
            <strong>Cómo se juega online</strong>
            <p>
              Todos reciben tarjetas secretas al mismo tiempo. Cuando alguien tenga una
              pista, la publica. El equipo puede hablar, pero la primera coordenada que se
              pulse es la respuesta final: si acierta, la tarjeta ocupa la casilla; si falla,
              se descarta sin mostrar su coordenada.
            </p>
          </div>
        </div>

        <div class="lobby-panel card">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">Jugadores</span>
              <h2>{players.length}/6 conectados</h2>
            </div>
          </div>

          <div class="player-list">
            {#each players as player}
              <div class="player-row">
                <span class:online={isOnline(player)} class="status-dot"></span>
                <strong>{player.display_name}</strong>
                {#if player.user_id === room.host_user_id}<small>Anfitrión</small>{/if}
                {#if player.id === currentPlayer?.id}<small>Vos</small>{/if}
              </div>
            {/each}
          </div>

          {#if isHost}
            <div class="settings-box">
              <label>
                Tamaño de grilla
                <select bind:value={lobbyGridSize}>
                  <option value={3}>Rápida 3×3</option>
                  <option value={4}>Clásica 4×4</option>
                  <option value={5}>Experta 5×5</option>
                </select>
              </label>

              <label class="toggle-card">
                <input type="checkbox" bind:checked={lobbyTimerEnabled} />
                <span>
                  <strong>Usar reloj</strong>
                  <small>{lobbyGridSize === 5 ? '10 minutos' : '5 minutos'}</small>
                </span>
              </label>

              <button class="secondary full" disabled={actionLoading} on:click={saveSettings}>Guardar configuración</button>
              <button class="primary large full" disabled={actionLoading || players.length < 2} on:click={handleStart}>
                Empezar partida
              </button>
            </div>
          {:else}
            <div class="waiting-box">Esperando a que el anfitrión inicie…</div>
          {/if}

          <button class="text-button" disabled={actionLoading} on:click={handleLeaveLobby}>Salir de la sala</button>
        </div>
      </section>
    {:else if room.status === 'playing'}
      <section class="game-layout">
        <div class="game-header">
          <div>
            <span class="eyebrow">Partida en curso</span>
            <h1>No hay turnos</h1>
            <p>Publicá tu pista apenas la tengas. Solo puede resolverse una a la vez.</p>
          </div>

          <div class="game-stats">
            <div class:urgent={secondsLeft !== null && secondsLeft <= 30}>
              <small>Tiempo</small>
              <strong>{formatTime(secondsLeft)}</strong>
            </div>
            <div>
              <small>Aciertos</small>
              <strong>{room.score}/{totalCards}</strong>
            </div>
            <div>
              <small>Mazo</small>
              <strong>{deckCount}</strong>
            </div>
          </div>
        </div>

        {#if lastGuess && lastResolvedCard}
          <div class:success={lastGuess.is_correct} class:error-result={!lastGuess.is_correct} class="last-result card">
            <div class="result-coordinate">
              <small>Intento</small>
              <strong>{coordinate(lastGuess.selected_row, lastGuess.selected_col)}</strong>
            </div>
            <div class="result-copy">
              <span>{playerName(lastGuess.player_id)} respondió</span>
              <strong>
                {lastGuess.is_correct
                  ? 'La respuesta fue correcta'
                  : 'La respuesta fue incorrecta'}
              </strong>
              <span>
                Pista: “{lastResolvedCard.clue}”.
                {lastGuess.is_correct ? ' La tarjeta quedó en la grilla.' : ' La tarjeta se perdió.'}
              </span>
            </div>
            <div class="result-icon">{lastGuess.is_correct ? '✓' : '×'}</div>
          </div>
        {/if}

        <div class="play-columns">
          <div class="board-card card">
            {#if activeCard}
              <div class="active-clue-banner">
                <small>{activeGiver?.display_name} dio la pista</small>
                <strong>{activeCard.clue}</strong>
                {#if isActiveGiver}
                  <span>Esperá la única respuesta del equipo.</span>
                {:else}
                  <span>La primera casilla pulsada será la respuesta final.</span>
                {/if}
              </div>
            {:else}
              <div class="thinking-banner">
                <div class="pulse-dot"></div>
                <div>
                  <strong>Todos están pensando</strong>
                  <span>Cualquier jugador puede publicar la próxima pista.</span>
                </div>
              </div>
            {/if}

            <div class="board-scroll">
              <div
                class="board"
                style={`grid-template-columns: minmax(6.5rem, 1fr) repeat(${room.grid_size}, minmax(4.6rem, 1fr));`}
              >
                <div class="corner-cell">×</div>
                {#each room.column_words ?? [] as columnWord, colIndex}
                  <div class="axis-cell column-axis">
                    <span>{letters[colIndex]}</span>
                    <strong>{columnWord}</strong>
                  </div>
                {/each}

                {#each room.row_words ?? [] as rowLabel, rowIndex}
                  <div class="axis-cell row-axis">
                    <span>{rowIndex + 1}</span>
                    <strong>{rowLabel}</strong>
                  </div>

                  {#each room.column_words ?? [] as _, colIndex}
                    {@const solvedCard = correctCardAt(rowIndex, colIndex)}
                    <button
                      type="button"
                      class:solved={Boolean(solvedCard)}
                      class:answerable={canAnswer && !solvedCard}
                      class="board-cell"
                      disabled={!canAnswer || Boolean(solvedCard) || answerSending}
                      on:click={() => answerCell(rowIndex, colIndex)}
                      aria-disabled={Boolean(solvedCard)}
                      aria-label={solvedCard
                        ? `Coordenada ${coordinate(rowIndex, colIndex)} acertada: ${solvedCard.clue}`
                        : `Coordenada ${coordinate(rowIndex, colIndex)}`}
                    >
                      <small>{coordinate(rowIndex, colIndex)}</small>
                      {#if solvedCard}
                        <strong>{solvedCard.clue}</strong>
                      {:else}
                        <span>+</span>
                      {/if}
                    </button>
                  {/each}
                {/each}
              </div>
            </div>
          </div>

          <aside class="side-column">
            <div class="hand-card card">
              <div class="panel-heading">
                <div>
                  <span class="eyebrow">Tu mano privada</span>
                  <h2>{ownHandCards.length} tarjeta{ownHandCards.length === 1 ? '' : 's'}</h2>
                </div>
                <span class="private-pill">Solo vos</span>
              </div>

              {#if ownHandCards.length > 0}
                <div class="secret-cards">
                  {#each ownHandCards as card}
                    {@const cardTarget = targetFor(card.id)}
                    <button
                      class:selected-secret={selectedCard?.id === card.id}
                      class="secret-card"
                      disabled={Boolean(activeCard)}
                      on:click={() => {
                        selectedCardId = card.id;
                        clueText = '';
                      }}
                    >
                      <span>{cardTarget ? coordinate(cardTarget.target_row, cardTarget.target_col) : '…'}</span>
                      <strong>{rowWord(cardTarget)} + {columnWord(cardTarget)}</strong>
                    </button>
                  {/each}
                </div>

                <label class="clue-input">
                  Pista de una sola palabra
                  <input
                    bind:value={clueText}
                    maxlength="30"
                    disabled={Boolean(activeCard)}
                    placeholder="Ejemplo: Veterinario"
                    on:input={() => (clueText = clueText.replace(/\s/g, ''))}
                    on:keydown={(event) => event.key === 'Enter' && !activeCard && clueText.length >= 2 && handleClue()}
                  />
                </label>

                <button
                  class="primary full"
                  disabled={actionLoading || Boolean(activeCard) || clueText.trim().length < 2}
                  on:click={handleClue}
                >
                  Publicar pista
                </button>

                {#if activeCard}
                  <p class="microcopy">Otra pista llegó primero. Tu tarjeta sigue intacta.</p>
                {:else}
                  <p class="microcopy">No uses una palabra de la grilla, una raíz igual ni una pista ya utilizada.</p>
                {/if}
              {:else}
                <div class="waiting-box">
                  No tenés tarjetas ahora. Cuando alguien resuelva una tarjeta y queden cartas en el mazo,
                  quien dio la pista recibirá otra.
                </div>
              {/if}
            </div>

            <div class="progress-card card">
              <div><span>Correctas</span><strong>{correctCards.length}</strong></div>
              <div><span>Descartadas</span><strong>{discardedCards.length}</strong></div>
              <div><span>En manos</span><strong>{cardsInHands}</strong></div>
            </div>

            <div class="rule-reminder card">
              <strong>Una sola respuesta</strong>
              <p>
                Pueden debatir por voz, pero solo una persona debe tocar la casilla acordada. No se puede
                cambiar: el primer clic aceptado por Supabase decide la tarjeta.
              </p>
            </div>
          </aside>
        </div>
      </section>
    {:else if room.status === 'finished'}
      {@const result = scoreLevel(room.grid_size, room.score)}
      <section class="center-card final-card">
        <span class="eyebrow">Partida terminada</span>
        <h1>{result[0]}</h1>
        <div class="final-score">
          <strong>{room.score}</strong>
          <span>de {room.grid_size * room.grid_size} tarjetas</span>
        </div>
        <p>{result[1]}</p>
        <div class="final-breakdown">
          <span>{correctCards.length} correctas</span>
          <span>{discardedCards.length} descartadas</span>
        </div>

        {#if isHost}
          <button class="primary large" disabled={actionLoading} on:click={handleRestart}>Jugar otra vez</button>
        {:else}
          <div class="waiting-box">El anfitrión puede iniciar otra partida.</div>
        {/if}
        <button class="text-button" on:click={exitToHome}>Volver al inicio</button>
      </section>
    {/if}

    {#if error}
      <div class="toast error" role="alert">
        <strong>Error</strong>
        <span>{error}</span>
        <button on:click={() => (error = '')} aria-label="Cerrar">×</button>
      </div>
    {/if}

    {#if notice}
      <div class="toast notice" role="status">
        <span>{notice}</span>
        <button on:click={() => (notice = '')} aria-label="Cerrar">×</button>
      </div>
    {/if}
  </main>
</div>

<style>
  :global(*) { box-sizing: border-box; }

  :global(html) {
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f4f4f1;
    color: #18181b;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    background:
      radial-gradient(circle at 8% 8%, rgba(234, 88, 12, 0.11), transparent 25rem),
      radial-gradient(circle at 92% 75%, rgba(15, 118, 110, 0.1), transparent 30rem),
      #f4f4f1;
  }

  :global(button), :global(input), :global(select) { font: inherit; }
  :global(button) { cursor: pointer; }
  :global(button:disabled) { cursor: not-allowed; opacity: 0.55; }

  .app-shell { min-height: 100vh; }

  .topbar {
    height: 74px;
    padding: 0 clamp(1rem, 4vw, 4rem);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.88);
    border-bottom: 1px solid #deded9;
    backdrop-filter: blur(12px);
    position: sticky;
    top: 0;
    z-index: 30;
  }

  .brand {
    border: 0;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0;
    text-align: left;
    color: inherit;
  }

  .brand-grid {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 13px;
    background: #18181b;
    color: #f97316;
    font-size: 1.5rem;
  }

  .brand strong, .brand small { display: block; }
  .brand small { color: #71717a; }

  .room-badge {
    border: 1px solid #d4d4d8;
    background: white;
    border-radius: 999px;
    padding: 0.55rem 0.9rem;
    letter-spacing: 0.06em;
  }

  main {
    width: min(1240px, calc(100% - 2rem));
    margin: 0 auto;
    padding: clamp(2rem, 5vw, 4rem) 0 5rem;
  }

  .hero {
    min-height: calc(100vh - 160px);
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: clamp(2rem, 6vw, 6rem);
    align-items: center;
  }

  .hero h1, .game-header h1, .lobby-layout h1, .final-card h1 {
    margin: 0.45rem 0 1rem;
    letter-spacing: -0.055em;
    line-height: 0.96;
  }

  .hero h1 { font-size: clamp(2.8rem, 6.5vw, 6rem); }
  .hero-copy p, .lead, .game-header p { color: #52525b; line-height: 1.7; }

  .eyebrow {
    color: #ea580c;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.72rem;
    font-weight: 900;
  }

  .card, .home-panel, .center-card {
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid #deded9;
    border-radius: 24px;
    box-shadow: 0 18px 55px rgba(24, 24, 27, 0.07);
  }

  .home-panel, .lobby-panel, .hand-card, .board-card { padding: clamp(1.2rem, 3vw, 2rem); }

  label { display: grid; gap: 0.5rem; font-weight: 800; font-size: 0.9rem; }

  input, select {
    width: 100%;
    min-height: 48px;
    border: 1px solid #d4d4d8;
    border-radius: 12px;
    background: white;
    color: #18181b;
    padding: 0.75rem 0.9rem;
    outline: none;
  }

  input:focus, select:focus {
    border-color: #f97316;
    box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.12);
  }

  .option-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0 1.2rem; }

  .toggle-card {
    grid-template-columns: auto 1fr;
    align-items: center;
    border: 1px solid #d4d4d8;
    border-radius: 12px;
    padding: 0.7rem 0.8rem;
    background: white;
  }

  .toggle-card input { width: 20px; min-height: 20px; }
  .toggle-card span, .toggle-card strong, .toggle-card small { display: block; }
  .toggle-card small { color: #71717a; margin-top: 0.1rem; }

  .primary, .secondary {
    min-height: 46px;
    border-radius: 12px;
    border: 1px solid transparent;
    padding: 0.72rem 1rem;
    font-weight: 900;
  }

  .primary { background: #ea580c; color: white; box-shadow: 0 10px 22px rgba(234, 88, 12, 0.2); }
  .secondary { background: white; color: #18181b; border-color: #d4d4d8; }
  .primary:hover:not(:disabled), .secondary:hover:not(:disabled) { transform: translateY(-1px); }
  .large { min-height: 54px; font-size: 1rem; }
  .full { width: 100%; }

  .divider { display: flex; align-items: center; gap: 0.8rem; margin: 1.4rem 0; color: #a1a1aa; font-size: 0.8rem; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #e4e4e7; }
  .join-row { display: grid; grid-template-columns: 1fr auto; gap: 0.7rem; }
  .code-input { text-transform: uppercase; letter-spacing: 0.22em; font-weight: 900; }

  .center-card { width: min(650px, 100%); margin: 4rem auto; padding: clamp(2rem, 5vw, 4rem); text-align: center; }
  .compact-center { display: grid; justify-items: center; }

  .lobby-layout { display: grid; grid-template-columns: 1fr 0.9fr; gap: 2rem; align-items: start; }
  .lobby-layout h1 { font-size: clamp(2.8rem, 6vw, 5rem); }
  .invite-card { margin-top: 2rem; padding: 1.2rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .invite-card small, .invite-card strong { display: block; }
  .invite-card strong { font-size: 2rem; letter-spacing: 0.16em; }
  .rules-card { padding: 1.3rem; margin-top: 1rem; }
  .rules-card p, .rule-reminder p { color: #52525b; line-height: 1.6; margin-bottom: 0; }

  .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .panel-heading h2 { margin: 0.25rem 0 0; }
  .player-list { display: grid; gap: 0.65rem; margin: 1.4rem 0; }
  .player-row { display: flex; align-items: center; gap: 0.7rem; padding: 0.8rem; border-radius: 12px; background: #f4f4f5; }
  .player-row small { margin-left: auto; color: #71717a; }
  .player-row small + small { margin-left: 0; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #a1a1aa; }
  .status-dot.online { background: #16a34a; box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.12); }
  .settings-box { display: grid; gap: 0.9rem; border-top: 1px solid #e4e4e7; padding-top: 1.2rem; }
  .waiting-box { border-radius: 14px; background: #f4f4f5; padding: 1rem; color: #52525b; line-height: 1.5; }
  .text-button { border: 0; background: transparent; color: #71717a; text-decoration: underline; margin-top: 1rem; }

  .game-layout { display: grid; gap: 1.2rem; }
  .game-header { display: flex; align-items: end; justify-content: space-between; gap: 2rem; }
  .game-header h1 { font-size: clamp(2.5rem, 5vw, 4.6rem); }
  .game-header p { margin-bottom: 0; }
  .game-stats { display: flex; gap: 0.7rem; flex-wrap: wrap; justify-content: flex-end; }
  .game-stats > div { min-width: 105px; background: white; border: 1px solid #deded9; border-radius: 16px; padding: 0.8rem 1rem; }
  .game-stats small, .game-stats strong { display: block; }
  .game-stats small { color: #71717a; }
  .game-stats strong { font-size: 1.35rem; margin-top: 0.1rem; }
  .game-stats .urgent { border-color: #dc2626; color: #dc2626; }

  .last-result {
    padding: 1rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    border-width: 2px;
  }
  .last-result.success { border-color: #16a34a; background: #dcfce7; box-shadow: 0 18px 42px rgba(22, 163, 74, 0.14); }
  .last-result.error-result { border-color: #dc2626; background: #fee2e2; box-shadow: 0 18px 42px rgba(220, 38, 38, 0.12); }
  .result-coordinate {
    width: 108px;
    min-height: 92px;
    border-radius: 16px;
    background: white;
    display: grid;
    place-content: center;
    text-align: center;
    border: 1px solid rgba(24, 24, 27, 0.08);
  }
  .result-coordinate small {
    color: #71717a;
    font-size: 0.72rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .result-coordinate strong {
    font-size: 2.8rem;
    line-height: 1;
    margin-top: 0.2rem;
  }
  .result-copy { min-width: 0; }
  .result-copy strong, .result-copy span { display: block; }
  .result-copy > span:first-child {
    color: #52525b;
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .result-copy strong {
    font-size: clamp(1.35rem, 3vw, 2.1rem);
    line-height: 1.05;
    margin: 0.12rem 0 0.25rem;
    overflow-wrap: anywhere;
  }
  .result-copy > span:last-child {
    color: #3f3f46;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .result-icon {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: white;
    font-size: 2rem;
    font-weight: 900;
    border: 1px solid rgba(24, 24, 27, 0.08);
  }

  .play-columns { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 1rem; align-items: start; }
  .board-card { min-width: 0; }
  .active-clue-banner { background: #18181b; color: white; border-radius: 18px; padding: 1.1rem; text-align: center; margin-bottom: 1rem; }
  .active-clue-banner small, .active-clue-banner strong, .active-clue-banner span { display: block; }
  .active-clue-banner small { color: #fdba74; }
  .active-clue-banner strong { font-size: clamp(2rem, 5vw, 4rem); margin: 0.15rem 0; }
  .active-clue-banner span { color: #d4d4d8; }
  .thinking-banner { display: flex; align-items: center; gap: 0.8rem; background: #f4f4f5; border-radius: 16px; padding: 1rem; margin-bottom: 1rem; }
  .thinking-banner strong, .thinking-banner span { display: block; }
  .thinking-banner span { color: #71717a; font-size: 0.9rem; }
  .pulse-dot { width: 13px; height: 13px; border-radius: 50%; background: #ea580c; animation: pulse 1.5s infinite; }

  .board-scroll { overflow-x: auto; padding-bottom: 0.35rem; }
  .board { min-width: 560px; display: grid; gap: 0.45rem; }
  .corner-cell, .axis-cell, .board-cell { min-height: 78px; border-radius: 14px; }
  .corner-cell { display: grid; place-items: center; background: #18181b; color: #f97316; font-size: 2rem; }
  .axis-cell { display: grid; align-content: center; gap: 0.15rem; padding: 0.7rem; background: #f4f4f5; border: 1px solid #e4e4e7; }
  .axis-cell span { color: #ea580c; font-weight: 900; font-size: 0.8rem; }
  .axis-cell strong { overflow-wrap: anywhere; }
  .board-cell { border: 1px dashed #d4d4d8; background: white; color: #a1a1aa; display: grid; place-items: center; align-content: center; gap: 0.1rem; padding: 0.45rem; }
  .board-cell small { font-weight: 900; }
  .board-cell > span { font-size: 1.3rem; }
  .board-cell.answerable { border-style: solid; border-color: #f97316; color: #ea580c; background: #fff7ed; opacity: 1; }
  .board-cell.answerable:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(234, 88, 12, 0.15); }
  .board-cell.solved,
  .board-cell.solved:disabled {
    border: 2px solid #15803d;
    background: #22c55e;
    color: #ffffff;
    opacity: 1 !important;
    cursor: not-allowed;
    pointer-events: none;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.2);
  }
  .board-cell.solved strong {
    color: #ffffff;
    overflow-wrap: anywhere;
  }
  .board-cell.solved small { color: #dcfce7; }

  .side-column { display: grid; gap: 1rem; }
  .private-pill { border-radius: 999px; background: #18181b; color: white; padding: 0.4rem 0.65rem; font-size: 0.72rem; font-weight: 800; }
  .secret-cards { display: grid; gap: 0.6rem; margin: 1.1rem 0; }
  .secret-card { width: 100%; border: 1px solid #d4d4d8; border-radius: 14px; background: #fafafa; padding: 0.8rem; text-align: left; color: #18181b; }
  .secret-card span, .secret-card strong { display: block; }
  .secret-card span { color: #ea580c; font-size: 1.25rem; font-weight: 900; }
  .secret-card strong { margin-top: 0.15rem; }
  .secret-card.selected-secret { border-color: #ea580c; box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.1); background: #fff7ed; }
  .clue-input { margin-bottom: 0.8rem; }
  .microcopy { color: #71717a; font-size: 0.78rem; line-height: 1.45; margin-bottom: 0; }
  .progress-card { padding: 1rem; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; text-align: center; }
  .progress-card div { padding: 0.55rem 0.2rem; border-right: 1px solid #e4e4e7; }
  .progress-card div:last-child { border-right: 0; }
  .progress-card span, .progress-card strong { display: block; }
  .progress-card span { color: #71717a; font-size: 0.75rem; }
  .progress-card strong { font-size: 1.3rem; }
  .rule-reminder { padding: 1rem; }

  .final-card h1 { font-size: clamp(3.5rem, 9vw, 7rem); }
  .final-score { margin: 1.2rem auto; width: 180px; height: 180px; border-radius: 50%; background: #18181b; color: white; display: grid; place-content: center; }
  .final-score strong { font-size: 4rem; line-height: 1; }
  .final-score span { color: #d4d4d8; }
  .final-breakdown { display: flex; justify-content: center; gap: 1rem; margin: 1rem 0 1.5rem; color: #52525b; }
  .final-card .primary { display: block; margin: 0 auto; }

  .toast { position: fixed; right: 1rem; bottom: 1rem; max-width: min(430px, calc(100% - 2rem)); border-radius: 15px; padding: 0.9rem 1rem; display: grid; grid-template-columns: auto 1fr auto; gap: 0.7rem; align-items: center; box-shadow: 0 20px 50px rgba(0,0,0,0.18); z-index: 50; }
  .toast.error { background: #7f1d1d; color: white; }
  .toast.notice { background: #18181b; color: white; grid-template-columns: 1fr auto; }
  .toast button { border: 0; background: transparent; color: inherit; font-size: 1.3rem; }

  .spinner { width: 34px; height: 34px; border: 4px solid #e4e4e7; border-top-color: #ea580c; border-radius: 50%; animation: spin 0.8s linear infinite; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 50% { transform: scale(1.35); opacity: 0.45; } }

  @media (max-width: 960px) {
    .hero, .lobby-layout, .play-columns { grid-template-columns: 1fr; }
    .game-header { align-items: start; flex-direction: column; }
    .game-stats { justify-content: flex-start; }
    .side-column { grid-template-columns: 1fr 1fr; }
    .hand-card { grid-column: 1 / -1; }
  }

  @media (max-width: 640px) {
    main { width: min(100% - 1rem, 1240px); padding-top: 1.2rem; }
    .topbar { height: 66px; padding-inline: 0.7rem; }
    .brand-grid { width: 38px; height: 38px; }
    .room-badge { font-size: 0.8rem; }
    .hero { min-height: auto; }
    .hero h1 { font-size: 2.8rem; }
    .option-grid, .side-column { grid-template-columns: 1fr; }
    .join-row { grid-template-columns: 1fr; }
    .invite-card { align-items: stretch; flex-direction: column; }
    .game-stats { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
    .game-stats > div { min-width: 0; padding: 0.7rem; }
    .game-stats strong { font-size: 1.05rem; }
    .board-card, .hand-card { padding: 0.8rem; border-radius: 18px; }
    .active-clue-banner strong { font-size: 2.4rem; }
    .last-result { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; }
    .result-coordinate { width: auto; min-height: 76px; }
    .result-coordinate strong { font-size: 2.25rem; }
    .result-copy { grid-column: 1 / -1; }
    .result-icon { width: 46px; height: 46px; font-size: 1.55rem; }
  }
</style>
