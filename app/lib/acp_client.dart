import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

class AcpError extends Error {
  final String message;
  AcpError(this.message);
}
class AcpClient {
  WebSocketChannel? _channel;
  int _id = 0;
  final Map<int, Completer<Map<String, dynamic>>> _pending = {};

  StreamSubscription? _sub;

  final StreamController<String> _text = StreamController<String>.broadcast();
  final StreamController<_ToolEvent> _tools = StreamController<_ToolEvent>.broadcast();
  final StreamController<String> _status = StreamController<String>.broadcast();

  String get sessionId {
    if (_channel == null) return '';
    return _sid;
  }
  String _sid = '';

  Stream<String> get text => _text.stream;
  Stream<_ToolEvent> get tools => _tools.stream;
  Stream<String> get status => _status.stream;

  Future<void> connect(String url, {String? secretKey}) async {
    final wsUrl = secretKey == null || secretKey.isEmpty
        ? url
        : '$url?token=${Uri.encodeQueryComponent(secretKey)}';
    _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
    _sub = _channel!.stream.listen(
      (dynamic data) {
        _handle(data);
      },
      onError: (Object e) {
        _status.add('连接错误: $e');
      },
      onDone: () => _status.add('连接已断开'),
    );
    await _send('initialize', {
      'protocolVersion': 1,
      'clientCapabilities': {},
    });
  }

  void _handle(dynamic raw) {
    if (raw is! String) return;
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    final id = msg['id'];
    if (id is int && _pending.containsKey(id)) {
      _pending.remove(id)?.complete(msg['result'] as Map<String, dynamic>? ?? {});
      return;
    }

    final method = msg['method'] as String?;
    if (method == null) return;

    if (method == 'session/notification') {
      final params = msg['params'] as Map<String, dynamic>? ?? {};
      final update = params['update'] as Map<String, dynamic>?;
      if (update == null) return;
      final uType = update['sessionUpdate'] as String?;
      if (uType == 'agent_message_chunk') {
        final content = (update['content'] as Map<String, dynamic>?)?.['text'];
        if (content is String) _text.add(content);
      } else if (uType == 'tool_call' || uType == 'tool_call_update') {
        _tools.add(_ToolEvent(
          type: uType,
          toolCallId: (update['toolCallId'] as String?) ?? '',
          title: (update['title'] as String?) ??
              (update['toolCall'] as Map<String, dynamic>?)?['title'] as String? ??
              'tool',
          raw: update,
        ));
      }
      } else if (method == 'session_update') {
        final params = msg['params'] as Map<String, dynamic>? ?? {};
        final update = params['update'] as Map<String, dynamic>?;
        if (update != null) {
          _dispatchUpdate(update);
        }
      } else if (method == 'session/update') {
        final params = msg['params'] as Map<String, dynamic>? ?? {};
        final update = params['update'] as Map<String, dynamic>?;
        if (update == null) return;
        _dispatchUpdate(update);
      } else if (method == 'session/request_permission' || method == 'requestPermission') {
        _respondPermission(msg);
      }
    }
  }

  void _dispatchUpdate(Map<String, dynamic> update) {
    final uType = update['sessionUpdate'] as String?;
    if (uType == 'agent_message_chunk') {
      final content = (update['content'] as Map<String, dynamic>?)?.['text'];
      if (content is String) _text.add(content);
    } else if (uType == 'tool_call' || uType == 'tool_call_update') {
      _tools.add(_ToolEvent(
        type: uType,
        toolCallId: (update['toolCallId'] as String?) ?? '',
        title: (update['title'] as String?) ??
            (update['toolCall'] as Map<String, dynamic>?)?['title'] as String? ??
            'tool',
        raw: update,
      ));
    }
  }

  void _respondPermission(Map<String, dynamic> msg) {
    final id = msg['id'];
    if (id == null) return;
    final out = jsonEncode({
      'jsonrpc': '2.0',
      'id': id,
      'result': {
        'outcome': {
          'outcome': 'selected',
          'optionId': 'allow_once',
        },
      },
    });
    _channel?.sink.add(out);
  }

  Future<Map<String, dynamic>> _send(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    final rid = ++_id;
    final completer = Completer<Map<String, dynamic>>();
    _pending[rid] = completer;
    final out = jsonEncode({
      'jsonrpc': '2.0',
      'id': rid,
      'method': method,
      'params': params,
    });
    _channel?.sink.add(out);
    return completer.future;
  }

  Future<void> newSession({String? cwd}) async {
    final res = await _send('session/new', {
      if (cwd != null) 'cwd': cwd,
      'mcpServers': <Map<String, dynamic>>[],
    });
    _sid = (res['sessionId'] as String?) ?? '';
    _status.add('会话已创建');
  }

  Future<void> prompt(String text) async {
    await _send('session/prompt', {
      'sessionId': _sid,
      'prompt': [
        {
          'type': 'text',
          'text': text,
        }
      ],
    });
  }

  Future<void> dispose() async {
    await _sub?.cancel();
    await _channel?.sink.close();
    _channel = null;
  }
}

class _ToolEvent {
  final String type;
  final String toolCallId;
  final String title;
  final Map<String, dynamic> raw;
  _ToolEvent({required this.type, required this.toolCallId, required this.title, required this.raw});
}
