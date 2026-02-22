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
const resultList = document.getElementById('resultList');
const statusLine = document.getElementById('status');

recommendBtn.addEventListener('click', async () => {
  const profile = readProfile();

  if (!profile.apiKey) {
    setBusy(false, 'AI専用モードです。OpenAI API Keyを入力してください。');
    return;
  }

  setBusy(true, 'AIが推薦を作成中です...');
  const supabaseClient = createSupabaseClient(profile);

  try {
    const catalog = await loadCatalog(supabaseClient);
    const recommendations = await recommendWithAI(profile, catalog);
    renderRecommendations(recommendations);
    await saveRecommendationLog(supabaseClient, profile, recommendations, 'ai');
    setBusy(false, `AI推薦を表示しました（${profile.model}）。`);
  } catch (error) {
    renderRecommendations([]);
    setBusy(false, `AI推薦に失敗しました: ${error.message}`);
  }
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
      temperature: 0.75,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'あなたは音楽推薦AIです。必ずJSONで5曲の推薦結果を返してください。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status}: ${detail.slice(0, 100)}`);
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
    '以下のユーザー向けにおすすめ曲を5件提案してください。',
    `好きな曲/アーティスト: ${profile.favorites.join(', ') || '未入力'}`,
    `年齢: ${profile.age > 0 ? profile.age : '未入力'}`,
    `職業: ${profile.job || '未入力'}`,
    `気分: ${profile.mood || '未入力'}`,
    `補足: ${profile.note || '未入力'}`,
    '候補曲:',
    catalogText,
    'JSON形式: {"recommendations":[{"title":"","artist":"","reason":"","score":1-10}]}'
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
    mode
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

function renderRecommendations(recommendations) {
  resultList.innerHTML = '';

  if (recommendations.length === 0) {
    const li = document.createElement('li');
    li.className = 'placeholder';
    li.textContent = '候補が見つかりませんでした。入力内容やAPI設定を確認してください。';
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
    meta.textContent = `モード: AI / スコア: ${song.score}`;

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
  statusLine.textContent = message;
}
