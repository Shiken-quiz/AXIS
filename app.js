const defaultSongCatalog = [
  { title: '群青', artist: 'YOASOBI', tags: ['jpop', 'upbeat', 'focus'] },
  { title: 'Pretender', artist: 'Official髭男dism', tags: ['jpop', 'nostalgic'] },
  { title: 'Lemon', artist: '米津玄師', tags: ['jpop', 'healing'] },
  { title: '怪獣の花唄', artist: 'Vaundy', tags: ['jpop', 'happy'] },
  { title: 'Lo-fi Study Beats', artist: 'Various Artists', tags: ['focus', 'relax'] }
];

const favoriteInput = document.getElementById('favoriteInput');
const ageInput = document.getElementById('ageInput');
const jobInput = document.getElementById('jobInput');
const moodInput = document.getElementById('moodInput');
const noteInput = document.getElementById('noteInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelInput = document.getElementById('modelInput');
const apiBaseInput = document.getElementById('apiBaseInput');
const sbUrlInput = document.getElementById('sbUrlInput');
const sbAnonKeyInput = document.getElementById('sbAnonKeyInput');
const recommendBtn = document.getElementById('recommendBtn');
const localBtn = document.getElementById('localBtn');
const resultList = document.getElementById('resultList');
const statusLine = document.getElementById('status');

recommendBtn.addEventListener('click', async () => {
  const profile = readProfile();
  setBusy(true, '推薦を作成中...');

  const supabaseClient = createSupabaseClient(profile);
  const catalog = await loadCatalog(supabaseClient);

  try {
    const recommendations = profile.apiKey
      ? await recommendWithAI(profile, catalog)
      : recommendWithLocal(profile, catalog);

    renderRecommendations(recommendations, profile.apiKey ? 'ai' : 'local');
    await saveRecommendationLog(supabaseClient, profile, recommendations, profile.apiKey ? 'ai' : 'local');
    setBusy(false, profile.apiKey ? 'AI推薦を表示しました。' : 'APIキー未設定のためローカル推薦を表示しました。');
  } catch (error) {
    const fallback = recommendWithLocal(profile, catalog);
    renderRecommendations(fallback, 'local');
    await saveRecommendationLog(supabaseClient, profile, fallback, 'local_fallback');
    setBusy(false, `AI失敗のためローカル推薦に切り替えました: ${error.message}`);
  }
});

localBtn.addEventListener('click', async () => {
  const profile = readProfile();
  setBusy(true, 'ローカル推薦を作成中...');
  const supabaseClient = createSupabaseClient(profile);
  const catalog = await loadCatalog(supabaseClient);
  const recommendations = recommendWithLocal(profile, catalog);
  renderRecommendations(recommendations, 'local');
  await saveRecommendationLog(supabaseClient, profile, recommendations, 'local');
  setBusy(false, 'ローカル推薦を表示しました。');
});

function readProfile() {
  return {
    favorites: favoriteInput.value.split(',').map((x) => x.trim()).filter(Boolean),
    age: Number(ageInput.value),
    job: jobInput.value,
    mood: moodInput.value,
    note: noteInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || 'gpt-4o-mini',
    apiBase: (apiBaseInput.value.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    sbUrl: sbUrlInput.value.trim(),
    sbAnonKey: sbAnonKeyInput.value.trim()
  };
}

function createSupabaseClient(profile) {
  if (!profile.sbUrl || !profile.sbAnonKey || !window.supabase) return null;
  return window.supabase.createClient(profile.sbUrl, profile.sbAnonKey);
}

async function loadCatalog(supabaseClient) {
  if (!supabaseClient) return defaultSongCatalog;

  const { data, error } = await supabaseClient
    .from('songs')
    .select('title,artist,tags,is_active')
    .eq('is_active', true)
    .limit(200);

  if (error || !Array.isArray(data) || data.length === 0) {
    return defaultSongCatalog;
  }

  return data.map((row) => ({
    title: row.title,
    artist: row.artist,
    tags: Array.isArray(row.tags) ? row.tags : []
  }));
}

function recommendWithLocal(profile, catalog) {
  const favLower = profile.favorites.map((f) => f.toLowerCase());

  return catalog
    .map((song) => {
      let score = 0;
      const reasons = [];

      if (favLower.some((fav) => song.title.toLowerCase().includes(fav) || song.artist.toLowerCase().includes(fav))) {
        score += 4;
        reasons.push('好きな曲/アーティストに近い');
      }
      if (profile.mood && song.tags.includes(profile.mood)) {
        score += 2;
        reasons.push(`気分タグ一致: ${profile.mood}`);
      }
      if (profile.note && profile.note.length > 0) {
        score += 1;
        reasons.push('追加メモを考慮');
      }

      return { title: song.title, artist: song.artist, score, reason: reasons.join('、') || '傾向一致' };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function recommendWithAI(profile, catalog) {
  const endpoint = `${profile.apiBase}/chat/completions`;
  const prompt = buildPrompt(profile, catalog);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${profile.apiKey}`
    },
    body: JSON.stringify({
      model: profile.model,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'あなたは音楽推薦AIです。理由付きで5曲をJSONで返してください。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI応答が空です');

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.recommendations)) throw new Error('recommendations配列がありません');

  return parsed.recommendations.slice(0, 5).map((item, idx) => ({
    title: item.title || `提案曲${idx + 1}`,
    artist: item.artist || 'Unknown Artist',
    score: Number(item.score) || 0,
    reason: item.reason || 'AI提案'
  }));
}

function buildPrompt(profile, catalog) {
  const catalogText = catalog.map((song) => `${song.title} - ${song.artist} (${song.tags.join(',')})`).join('\n');

  return [
    '以下ユーザー向けに5曲を推薦してください。',
    `好きな曲/アーティスト: ${profile.favorites.join(', ') || '未入力'}`,
    `年齢: ${profile.age > 0 ? profile.age : '未入力'}`,
    `職業: ${profile.job || '未入力'}`,
    `気分: ${profile.mood || '未入力'}`,
    `補足: ${profile.note || '未入力'}`,
    '候補曲:',
    catalogText,
    '出力JSON: {"recommendations":[{"title":"","artist":"","reason":"","score":1-10}]}'
  ].join('\n');
}

async function saveRecommendationLog(supabaseClient, profile, recommendations, mode) {
  if (!supabaseClient || recommendations.length === 0) return;

  const payload = {
    input_favorites: profile.favorites,
    input_age: Number.isFinite(profile.age) ? profile.age : null,
    input_job: profile.job || null,
    input_mood: profile.mood || null,
    input_note: profile.note || null,
    model_name: profile.model || null,
    mode,
    recommendation_count: recommendations.length
  };

  const { data: inserted, error: logError } = await supabaseClient
    .from('recommendation_logs')
    .insert([payload])
    .select('id')
    .single();

  if (logError || !inserted?.id) return;

  const items = recommendations.map((song, idx) => ({
    log_id: inserted.id,
    rank_no: idx + 1,
    title: song.title,
    artist: song.artist,
    reason: song.reason,
    score: song.score
  }));

  await supabaseClient.from('recommendation_items').insert(items);
}

function renderRecommendations(recommendations, mode) {
  resultList.innerHTML = '';

  if (recommendations.length === 0) {
    const li = document.createElement('li');
    li.className = 'placeholder';
    li.textContent = '候補が見つかりませんでした。条件を追加してください。';
    resultList.appendChild(li);
    return;
  }

  recommendations.forEach((song, index) => {
    const item = document.createElement('li');
    item.className = 'result-item';

    const title = document.createElement('p');
    title.className = 'result-title';
    title.textContent = `${index + 1}. ${song.title} - ${song.artist}`;

    const meta = document.createElement('p');
    meta.className = 'result-meta';
    meta.textContent = `モード: ${mode} / スコア: ${song.score}`;

    const reason = document.createElement('p');
    reason.className = 'reason';
    reason.textContent = `理由: ${song.reason}`;

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(reason);
    resultList.appendChild(item);
  });
}

function setBusy(flag, message) {
  recommendBtn.disabled = flag;
  localBtn.disabled = flag;
  statusLine.textContent = message;
}
