const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// DOM
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const nameInput = document.getElementById('nameInput');
const sendBtn = document.getElementById('sendBtn');

// 投稿送信
sendBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim() || '名無し';
  const content = messageInput.value.trim();
  if (!content) return;

  await supabase.from('messages').insert([{ name, content }]);
  messageInput.value = '';
});

// メッセージ取得
async function fetchMessages() {
  const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false });
  messagesDiv.innerHTML = '';
  data.forEach(msg => {
    appendMessage(msg);
  });
}

// 投稿カードを作る関数
function appendMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message-card');

  const header = document.createElement('div');
  header.classList.add('message-header');
  header.textContent = msg.name;

  const time = document.createElement('div');
  time.classList.add('message-time');
  const date = new Date(msg.created_at);
  time.textContent = date.toLocaleString();

  const content = document.createElement('div');
  content.classList.add('message-content');
  content.textContent = msg.content;

  header.appendChild(time);
  div.appendChild(header);
  div.appendChild(content);
  messagesDiv.appendChild(div);
}

// リアルタイム購読
function subscribeMessages() {
  supabase.channel('messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      appendMessage(payload.new);
    })
    .subscribe();
}

// 初期読み込み
fetchMessages();
subscribeMessages();
