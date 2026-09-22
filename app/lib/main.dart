import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'acp_client.dart';

void main() => runApp(const AgentApp());

class AgentApp extends StatelessWidget {
  const AgentApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Agent',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0F1117),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4F8CFF),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: const ChatScreen(),
    );
  }
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  AcpClient? _client;
  final List<_Msg> _msgs = [];
  final List<_ToolCard> _toolCards = [];
  final TextEditingController _inputCtrl =
      TextEditingController(text: 'ws://127.0.0.1:3284/acp');
  final TextEditingController _secretCtrl = TextEditingController();
  final TextEditingController _msgCtrl = TextEditingController();
  final ScrollController _scroll = ScrollController();
  String _status = '未连接';
  bool _busy = false;
  String _pendingText = '';

  @override
  void dispose() {
    _inputCtrl.dispose();
    _secretCtrl.dispose();
    _msgCtrl.dispose();
    _scroll.dispose();
    _client?.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    setState(() {
      _status = '连接中...';
      _client?.dispose();
      _client = AcpClient();
    });
    try {
      await _client!.connect(
        _inputCtrl.text.trim(),
        secretKey: _secretCtrl.text.trim().isEmpty ? null : _secretCtrl.text.trim(),
      );
      await _client!.newSession();
      _client!.text.listen((t) {
        setState(() => _pendingText += t);
        if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
      });
      _client!.tools.listen((ev) {
        if (ev.type == 'tool_call') {
          setState(() {
            _toolCards.add(_ToolCard(id: ev.toolCallId, title: ev.title));
          });
        } else if (ev.type == 'tool_call_update') {
          setState(() {
            for (final c in _toolCards) {
              if (c.id == ev.toolCallId) {
                c.status = _statusOf(ev.raw);
                c.output = _outputOf(ev.raw);
              }
            }
          });
        }
        if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
      });
      _client!.status.listen((s) => setState(() => _status = s));
      setState(() => _status = '已连接 · 会话已创建');
    } catch (e) {
      setState(() => _status = '连接失败: $e');
    }
  }

  Future<void> _send() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty || _client == null || _client!.sessionId.isEmpty) return;
    setState(() {
      _msgs.add(_Msg(role: 'user', text: text));
      _pendingText = '';
      _busy = true;
      _msgCtrl.clear();
    });
    _scroll.jumpTo(_scroll.position.maxScrollExtent);
    try {
      await _client!.prompt(text);
    } catch (e) {
      setState(() {
        _msgs.add(_Msg(role: 'system', text: '发送失败: $e'));
        _busy = false;
      });
    }
  }

  String _statusOf(Map<String, dynamic> raw) {
    final st = raw['status'] as String?;
    if (st != null) return st;
    final fields = raw['toolCall'] as Map<String, dynamic>?;
    return (fields?['status'] as String?) ?? 'in_progress';
  }

  String _outputOf(Map<String, dynamic> raw) {
    final fields = raw['toolCall'] as Map<String, dynamic>?;
    final content = fields?['content'] as List<dynamic>?;
    if (content == null) return raw['content']?.toString() ?? '';
    return content.map((e) {
      if (e is Map) return e['text']?.toString() ?? '';
      return e.toString();
    }).join();
  }

  @override
  Widget build(BuildContext context) {
    final agentText = _pendingText.trim().isNotEmpty
        ? _pendingText
        : (_msgs.isNotEmpty ? '' : '未收到回复');
    return Scaffold(
      appBar: AppBar(
        title: const Text('Agent'),
        actions: [
          Text(
            _status,
            style: TextStyle(fontSize: 12, color: Colors.grey[400]),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: Column(
        children: [
          if (_client == null)
            _buildConnectBar(),
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(16),
              itemCount: _msgs.length + _toolCards.length + (agentText.isEmpty ? 0 : 1),
              itemBuilder: (context, i) {
                // interleaved: user/agent messages + tool cards
                if (i < _msgs.length) {
                  final m = _msgs[i];
                  return _Bubble(role: m.role, text: m.text, isAgent: m.role != 'user');
                }
                final toolIdx = i - _msgs.length;
                if (toolIdx < _toolCards.length) {
                  final c = _toolCards[toolIdx];
                  return _ToolCardWidget(card: c);
                }
                return _Bubble(role: 'agent', text: agentText, isAgent: true);
              },
            ),
          ),
          _buildInputBar(),
        ],
      ),
    );
  }

  Widget _buildConnectBar() {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          TextField(
            controller: _inputCtrl,
            decoration: const InputDecoration(
              labelText: 'goose ACP 地址',
              hintText: 'ws://127.0.0.1:3284/acp',
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _secretCtrl,
            decoration: const InputDecoration(
              labelText: 'Secret Key (可选)',
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _connect,
            icon: const Icon(Icons.link),
            label: const Text('连接'),
          ),
        ],
      ),
    );
  }

  Widget _buildInputBar() {
    return Container(
      padding: EdgeInsets.only(
        left: 12,
        right: 12,
        bottom: 12,
        top: 8,
        bottom: MediaQuery.of(context).padding.bottom + 12,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFF171922),
        border: Border(top: BorderSide(color: Color(0xFF2A2C3A))),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _msgCtrl,
              decoration: InputDecoration(
                hintText: _client?.sessionId.isEmpty ?? true
                    ? '先连接 goose'
                    : '输入指令...',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide.none,
                ),
                filled: true,
                color: const Color(0xFF1F2230),
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 14),
              ),
              onSubmitted: (_) => _send(),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            onPressed: _busy || _client?.sessionId.isEmpty ?? true ? null : _send,
            icon: const Icon(Icons.send),
          ),
        ],
      ),
    );
  }
}

class _Msg {
  final String role;
  final String text;
  _Msg({required this.role, required this.text});
}

class _ToolCard {
  final String id;
  String title;
  String status = 'in_progress';
  String output = '';
  _ToolCard({required this.id, required this.title});
}

class _Bubble extends StatelessWidget {
  final String role;
  final String text;
  final bool isAgent;
  _Bubble({required this.role, required this.text, required this.isAgent});

  @override
  Widget build(BuildContext context) {
    final color = isAgent ? const Color(0xFF1F2230) : const Color(0xFF2E5CFF);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment:
            isAgent ? CrossAxisAlignment.start : CrossAxisAlignment.end,
        children: [
          if (isAgent)
            Text('Agent',
                style:
                    TextStyle(fontSize: 11, color: Colors.grey[500])),
          const SizedBox(height: 4),
          MarkdownBody(
            data: text,
            styleSheet: MarkdownStyleSheet(
              p: const TextStyle(color: Colors.white, fontSize: 14),
              inlineCode: const TextStyle(
                  color: Color(0xFF7FB0FF), fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolCardWidget extends StatelessWidget {
  final _ToolCard card;
  _ToolCardWidget({required this.card});

  @override
  Widget build(BuildContext context) {
    final done = card.status == 'completed' || card.status == 'success';
    final color = done
        ? Colors.greenAccent
        : (card.status == 'failed' ? Colors.redAccent : Colors.amberAccent);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF14161F),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                done ? Icons.check_circle : Icons.build,
                size: 16,
                color: color,
              ),
              const SizedBox(width: 6),
              Text(
                card.title,
                style: const TextStyle(
                    fontSize: 13,
                    color: Colors.white,
                    fontFamily: 'monospace'),
              ),
              const Spacer(),
              Text(card.status,
                  style: TextStyle(fontSize: 11, color: color)),
            ],
          ),
          if (card.output.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFF0B0C12),
                borderRadius: BorderRadius.circular(6),
              ),
              child: SelectableText(
                card.output,
                style: const TextStyle(
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: Colors.grey),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
