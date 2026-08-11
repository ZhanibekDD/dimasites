<?php
define('DNEPR_SOURCE_GATEWAY', true);
require dirname(__FILE__) . '/source-common.php';
/*
 * Same-origin gateway for a public company lookup in the official
 * "Transparent Business" service. It returns every safe field and document
 * link from the current search response, but never returns the FNS session,
 * CAPTCHA data or raw internal tokens.
 * Compatible with the older PHP runtime currently selected on Timeweb.
 */

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, max-age=0');

function dnepr_status_header($status)
{
    $messages = array(
        200 => 'OK',
        400 => 'Bad Request',
        403 => 'Forbidden',
        405 => 'Method Not Allowed',
        429 => 'Too Many Requests',
        502 => 'Bad Gateway',
        503 => 'Service Unavailable'
    );
    $message = isset($messages[$status]) ? $messages[$status] : 'Error';
    header('HTTP/1.1 ' . $status . ' ' . $message);
}

function dnepr_respond($status, $payload)
{
    dnepr_status_header($status);
    echo json_encode($payload);
    exit;
}

function dnepr_clean_query($value)
{
    $value = trim((string) $value);
    $clean = preg_replace('/\s+/u', ' ', $value);
    return $clean === null ? '' : $clean;
}

function dnepr_rate_allowed($ip)
{
    $path = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'dnepr-fns-rate-' . sha1($ip) . '.json';
    $now = time();
    $window = 600;
    $limit = 30;
    $handle = @fopen($path, 'c+');
    if (!$handle) {
        return true;
    }
    if (!@flock($handle, LOCK_EX)) {
        fclose($handle);
        return true;
    }
    $raw = stream_get_contents($handle);
    $state = json_decode($raw, true);
    if (!is_array($state) || !isset($state['started']) || ($now - (int) $state['started']) >= $window) {
        $state = array('started' => $now, 'count' => 0);
    }
    $allowed = (int) $state['count'] < $limit;
    if ($allowed) {
        $state['count'] = (int) $state['count'] + 1;
    }
    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($state));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    return $allowed;
}

function dnepr_cache_path($query)
{
    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'dnepr-fns-company-' . sha1($query) . '.json';
}

function dnepr_cache_read($query)
{
    $path = dnepr_cache_path($query);
    if (!is_file($path) || (time() - (int) @filemtime($path)) > 21600) {
        return null;
    }
    $payload = json_decode((string) @file_get_contents($path), true);
    if (!is_array($payload) || empty($payload['ok'])) {
        return null;
    }
    if (isset($payload['source']) && is_array($payload['source'])) {
        $payload['source']['cached'] = true;
    }
    return $payload;
}

function dnepr_cache_write($query, $payload)
{
    @file_put_contents(dnepr_cache_path($query), json_encode($payload), LOCK_EX);
}

function dnepr_fns_post($fields, $cookie, $withHeaders)
{
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'error' => 'На сервере недоступен модуль cURL.', 'errno' => -1, 'status' => 0, 'latency_ms' => 0);
    }
    $startedAt = microtime(true);
    $curl = curl_init('https://pb.nalog.ru/search-proc.json');
    $headers = array(
        'Accept: application/json, text/javascript, */*; q=0.01',
        'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With: XMLHttpRequest',
        'Origin: https://pb.nalog.ru',
        'Referer: https://pb.nalog.ru/search.html'
    );
    curl_setopt($curl, CURLOPT_POST, true);
    curl_setopt($curl, CURLOPT_POSTFIELDS, http_build_query($fields, '', '&'));
    curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($curl, CURLOPT_HEADER, $withHeaders ? true : false);
    curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 8);
    curl_setopt($curl, CURLOPT_TIMEOUT, 24);
    curl_setopt($curl, CURLOPT_FOLLOWLOCATION, false);
    curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, 2);
    curl_setopt($curl, CURLOPT_ENCODING, '');
    curl_setopt($curl, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36');
    curl_setopt($curl, CURLOPT_HTTPHEADER, $headers);
    if ($cookie !== '') {
        curl_setopt($curl, CURLOPT_COOKIE, $cookie);
    }
    if (defined('CURLOPT_IPRESOLVE') && defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($curl, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) {
        curl_setopt($curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        curl_setopt($curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
    }
    if (defined('CURLOPT_HTTP_VERSION') && defined('CURL_HTTP_VERSION_1_1')) {
        curl_setopt($curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    }
    $raw = curl_exec($curl);
    $errno = curl_errno($curl);
    $error = curl_error($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $headerSize = $withHeaders ? (int) curl_getinfo($curl, CURLINFO_HEADER_SIZE) : 0;
    curl_close($curl);

    if ($raw === false || $error !== '') {
        return array('ok' => false, 'error' => dnepr_source_failure_message($errno, $status), 'errno' => $errno, 'status' => $status, 'latency_ms' => (int) round((microtime(true) - $startedAt) * 1000));
    }
    if ($status !== 200) {
        return array('ok' => false, 'error' => dnepr_source_failure_message(0, $status), 'errno' => 0, 'status' => $status, 'latency_ms' => (int) round((microtime(true) - $startedAt) * 1000));
    }
    return array(
        'ok' => true,
        'headers' => $withHeaders ? substr($raw, 0, $headerSize) : '',
        'body' => $withHeaders ? substr($raw, $headerSize) : $raw,
        'status' => $status,
        'errno' => 0,
        'latency_ms' => (int) round((microtime(true) - $startedAt) * 1000)
    );
}

function dnepr_safe_official_url($value, $allowedHosts)
{
    $value = trim((string) $value);
    if ($value === '') {
        return null;
    }
    $parts = @parse_url($value);
    if (!is_array($parts) || !isset($parts['scheme']) || !isset($parts['host'])) {
        return null;
    }
    if (strtolower($parts['scheme']) !== 'https' || !in_array(strtolower($parts['host']), $allowedHosts, true)) {
        return null;
    }
    return $value;
}

function dnepr_row_value($row, $keys)
{
    foreach ($keys as $key) {
        if (isset($row[$key]) && trim((string) $row[$key]) !== '') {
            return (string) $row[$key];
        }
    }
    return '';
}

function dnepr_document($id, $label, $url, $kind, $note)
{
    if ($url === null || trim((string) $url) === '') {
        return null;
    }
    return array(
        'id' => $id,
        'label' => $label,
        'url' => $url,
        'kind' => $kind,
        'note' => $note
    );
}

function dnepr_append_document(&$documents, $document)
{
    if (is_array($document)) {
        $documents[] = $document;
    }
}

function dnepr_official_fields($row)
{
    $definitions = array(
        'namec' => 'Краткое наименование',
        'namep' => 'Полное наименование',
        'fio' => 'ФИО предпринимателя',
        'inn' => 'ИНН',
        'ogrn' => 'ОГРН',
        'ogrnip' => 'ОГРНИП',
        'sulst_name_ex' => 'Статус юридического лица',
        'sipst_name_ex' => 'Статус предпринимателя',
        'periodcode' => 'Отчётный период',
        'yearcode' => 'Отчётный год',
        'okopf12' => 'Код организационно-правовой формы',
        'sulst_ex' => 'Код статуса юридического лица',
        'sipst_ex' => 'Код статуса ИП',
        'pr_liq' => 'Признак ликвидации',
        'invalid' => 'Признак недостоверных сведений',
        'predo' => 'Признак ранее зарегистрированного лица',
        'okved2maintype' => 'Способ определения основного ОКВЭД',
        'okved2main' => 'Основной ОКВЭД',
        'okved2mainname' => 'Наименование основного ОКВЭД',
        'okved2' => 'ОКВЭД в поисковой выдаче',
        'okved2name' => 'Наименование ОКВЭД в поисковой выдаче',
        'dtreg' => 'Дата регистрации',
        'dtogrn' => 'Дата присвоения ОГРН',
        'dtogrnip' => 'Дата присвоения ОГРНИП',
        'regionname' => 'Регион'
    );
    $blocked = array('_dneprEntityType', 'token', 'egrulurl', 'rsmppdf', 'puchdocurl', 'gosregurl', 'bourl');
    $fields = array();
    foreach ($row as $key => $value) {
        if (in_array($key, $blocked, true) || is_array($value) || is_object($value)) { continue; }
        if (trim((string) $value) !== '') {
            $fields[] = array(
                'key' => $key,
                'label' => isset($definitions[$key]) ? $definitions[$key] : $key,
                'value' => (string) $value
            );
        }
    }
    return $fields;
}

function dnepr_safe_response_record($row)
{
    if (!is_array($row)) { return array(); }
    $blocked = array('token', 'egrulurl', 'rsmppdf', 'puchdocurl', 'gosregurl', 'bourl');
    $safe = array();
    foreach ($row as $key => $value) {
        if (in_array($key, $blocked, true) || is_array($value) || is_object($value)) { continue; }
        $safe[$key] = (string) $value;
        if (count($safe) >= 80) { break; }
    }
    return $safe;
}

function dnepr_response_sections($response)
{
    $labels = array(
        'ul' => 'Юридические лица', 'ip' => 'Индивидуальные предприниматели',
        'upr' => 'Управляющие организации', 'rdl' => 'Дисквалифицированные лица',
        'addr' => 'Адреса нескольких юридических лиц', 'ogrfl' => 'Ограничения физических лиц',
        'ogrul' => 'Ограничения юридических лиц', 'uchr' => 'Участие и учредители',
        'docul' => 'Документы юридических лиц', 'docip' => 'Документы предпринимателей'
    );
    $sections = array();
    foreach ($labels as $key => $label) {
        $part = isset($response[$key]) && is_array($response[$key]) ? $response[$key] : array();
        $data = isset($part['data']) && is_array($part['data']) ? $part['data'] : array();
        $records = array();
        foreach (array_slice($data, 0, 10) as $record) { $records[] = dnepr_safe_response_record($record); }
        $sections[] = array(
            'id' => $key,
            'label' => $label,
            'rowCount' => isset($part['rowCount']) ? (int) $part['rowCount'] : count($data),
            'returned' => count($data),
            'hasMore' => !empty($part['hasMore']),
            'records' => $records
        );
    }
    return $sections;
}

if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    dnepr_respond(405, array('ok' => false, 'code' => 'method_not_allowed', 'message' => 'Используйте POST-запрос.'));
}

$origin = isset($_SERVER['HTTP_ORIGIN']) ? strtolower(trim($_SERVER['HTTP_ORIGIN'])) : '';
if ($origin !== '' && $origin !== 'https://stroydnepr.ru' && $origin !== 'https://www.stroydnepr.ru') {
    dnepr_respond(403, array('ok' => false, 'code' => 'origin_denied', 'message' => 'Запрос разрешён только с сайта ДНЕПР.'));
}

$input = json_decode((string) file_get_contents('php://input'), true);
$query = is_array($input) && isset($input['query']) ? $input['query'] : (isset($_POST['query']) ? $_POST['query'] : '');
$query = dnepr_clean_query($query);
$length = function_exists('mb_strlen') ? mb_strlen($query, 'UTF-8') : strlen($query);
if ($length < 3 || $length > 180) {
    dnepr_respond(400, array('ok' => false, 'code' => 'invalid_query', 'message' => 'Введите ИНН, ОГРН или название компании.'));
}
if (!preg_match('/^[\p{L}\p{N}\s."«»()№&\x{27}’+,\-]+$/u', $query)) {
    dnepr_respond(400, array('ok' => false, 'code' => 'invalid_query', 'message' => 'В запросе есть неподдерживаемые символы.'));
}
if (preg_match('/^\d+$/', $query) && !in_array(strlen($query), array(10, 12, 13, 15), true)) {
    dnepr_respond(400, array('ok' => false, 'code' => 'invalid_identifier', 'message' => 'Для компании нужен ИНН из 10/12 цифр или ОГРН из 13/15 цифр.'));
}

$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
if (!dnepr_rate_allowed($ip)) {
    dnepr_respond(429, array('ok' => false, 'code' => 'rate_limited', 'message' => 'Слишком много проверок. Повторите через несколько минут.'));
}

$cached = dnepr_cache_read($query);
if ($cached !== null) {
    $cachedDiagnosticId = dnepr_source_diagnostic_id('fns');
    if (!isset($cached['source']) || !is_array($cached['source'])) { $cached['source'] = array(); }
    $cached['source']['diagnosticId'] = $cachedDiagnosticId;
    $cachedCompanies = isset($cached['companies']) && is_array($cached['companies']) ? $cached['companies'] : array();
    dnepr_source_log('fns', $query, count($cachedCompanies) > 0 ? 'found' : 'missing', $cachedDiagnosticId, array('result_count' => count($cachedCompanies), 'http_status' => 200, 'message' => 'Ответ выдан из серверного кэша.', 'results' => $cachedCompanies));
    dnepr_respond(200, $cached);
}
$diagnosticId = dnepr_source_diagnostic_id('fns');

$searchFields = array(
    'mode' => 'search-all', 'queryAll' => $query,
    'queryUl' => '', 'okvedUl' => '', 'okvedTypeUl' => '', 'regionUl' => '', 'statusUl' => '', 'isMspUl' => '',
    'mspUl1' => '1', 'mspUl2' => '1', 'mspUl3' => '1',
    'queryIp' => '', 'okvedIp' => '', 'okvedTypeIp' => '', 'regionIp' => '', 'statusIp' => '', 'isMspIp' => '',
    'mspIp1' => '1', 'mspIp2' => '1', 'mspIp3' => '1', 'taxIp' => '',
    'queryUpr' => '', 'uprType1' => '1', 'uprType0' => '1', 'queryRdl' => '', 'dateRdl' => '',
    'queryAddr' => '', 'regionAddr' => '', 'queryOgr' => '', 'ogrFl' => '1', 'ogrUl' => '1',
    'ogrnUlDoc' => '', 'ogrnIpDoc' => '', 'npTypeDoc' => '1', 'nameUlDoc' => '', 'nameIpDoc' => '',
    'formUlDoc' => '', 'formIpDoc' => '', 'ifnsDoc' => '', 'dateFromDoc' => '', 'dateToDoc' => '',
    'page' => '1', 'pageSize' => '10', 'pbCaptchaToken' => 'token'
);

$started = dnepr_fns_post($searchFields, '', true);
if (empty($started['ok'])) {
    dnepr_source_log('fns', $query, 'unavailable', $diagnosticId, array('http_status' => $started['status'], 'latency_ms' => $started['latency_ms'], 'error_code' => 'source_unavailable', 'message' => $started['error']));
    dnepr_respond(502, array('ok' => false, 'code' => 'source_unavailable', 'message' => $started['error'], 'diagnosticId' => $diagnosticId, 'technical' => array('stage' => 'start-search', 'httpStatus' => $started['status'], 'curlCode' => $started['errno'])));
}
$task = json_decode($started['body'], true);
if (!is_array($task) || empty($task['id'])) {
    dnepr_source_log('fns', $query, 'unavailable', $diagnosticId, array('http_status' => $started['status'], 'latency_ms' => $started['latency_ms'], 'error_code' => 'invalid_source_response', 'message' => 'ФНС вернула неожиданный ответ.'));
    dnepr_respond(502, array('ok' => false, 'code' => 'invalid_source_response', 'message' => 'ФНС вернула неожиданный ответ.', 'diagnosticId' => $diagnosticId));
}
if (!empty($task['captchaRequired'])) {
    dnepr_source_log('fns', $query, 'unavailable', $diagnosticId, array('http_status' => 200, 'latency_ms' => $started['latency_ms'], 'error_code' => 'captcha_required', 'message' => 'ФНС запросила ручную проверку.'));
    dnepr_respond(503, array('ok' => false, 'code' => 'captcha_required', 'message' => 'ФНС запросила ручную проверку. Откройте официальный сервис для продолжения.', 'diagnosticId' => $diagnosticId));
}

$cookie = '';
if (preg_match_all('/^Set-Cookie:\s*(JSESSIONID=[^;\r\n]+)/mi', $started['headers'], $matches) && !empty($matches[1])) {
    $cookie = $matches[1][count($matches[1]) - 1];
}
if ($cookie === '') {
    dnepr_source_log('fns', $query, 'unavailable', $diagnosticId, array('http_status' => 200, 'latency_ms' => $started['latency_ms'], 'error_code' => 'session_missing', 'message' => 'Не удалось создать защищённую сессию ФНС.'));
    dnepr_respond(502, array('ok' => false, 'code' => 'session_missing', 'message' => 'Не удалось создать защищённую сессию ФНС.', 'diagnosticId' => $diagnosticId));
}

$result = null;
for ($attempt = 0; $attempt < 5; $attempt += 1) {
    usleep($attempt === 0 ? 300000 : 400000);
    $received = dnepr_fns_post(array('id' => $task['id'], 'method' => 'get-response'), $cookie, false);
    if (empty($received['ok'])) {
        if ($attempt === 4) {
            dnepr_source_log('fns', $query, 'unavailable', $diagnosticId, array('http_status' => $received['status'], 'latency_ms' => $received['latency_ms'], 'error_code' => 'source_unavailable', 'message' => $received['error']));
            dnepr_respond(502, array('ok' => false, 'code' => 'source_unavailable', 'message' => $received['error'], 'diagnosticId' => $diagnosticId, 'technical' => array('stage' => 'receive-response', 'httpStatus' => $received['status'], 'curlCode' => $received['errno'])));
        }
        continue;
    }
    $decoded = json_decode($received['body'], true);
    if (is_array($decoded) && isset($decoded['ul']) && is_array($decoded['ul'])) {
        $result = $decoded;
        break;
    }
}
if ($result === null) {
    dnepr_source_log('fns', $query, 'unavailable', $diagnosticId, array('http_status' => 200, 'latency_ms' => 0, 'error_code' => 'source_timeout', 'message' => 'ФНС не успела подготовить ответ.'));
    dnepr_respond(502, array('ok' => false, 'code' => 'source_timeout', 'message' => 'ФНС не успела подготовить ответ. Повторите проверку.', 'diagnosticId' => $diagnosticId));
}

$legalRows = isset($result['ul']['data']) && is_array($result['ul']['data']) ? $result['ul']['data'] : array();
$entrepreneurRows = isset($result['ip']['data']) && is_array($result['ip']['data']) ? $result['ip']['data'] : array();
$rows = array();
foreach ($legalRows as $row) {
    if (is_array($row)) {
        $row['_dneprEntityType'] = 'legal_entity';
        $rows[] = $row;
    }
}
foreach ($entrepreneurRows as $row) {
    if (is_array($row)) {
        $row['_dneprEntityType'] = 'entrepreneur';
        $rows[] = $row;
    }
}
$companies = array();
foreach ($rows as $row) {
    if (!is_array($row)) {
        continue;
    }
    $entityType = isset($row['_dneprEntityType']) ? $row['_dneprEntityType'] : 'legal_entity';
    $documents = array();
    $boUrl = isset($row['bourl']) ? dnepr_safe_official_url($row['bourl'], array('bo.nalog.gov.ru')) : null;
    $smePdfUrl = isset($row['rsmppdf']) ? dnepr_safe_official_url($row['rsmppdf'], array('rmsp.nalog.ru')) : null;
    $charterUrl = isset($row['puchdocurl']) ? dnepr_safe_official_url($row['puchdocurl'], array('service.nalog.ru')) : null;
    $registrationUrl = isset($row['gosregurl']) ? dnepr_safe_official_url($row['gosregurl'], array('service.nalog.ru')) : null;
    dnepr_append_document($documents, dnepr_document(
        'registry-extract',
        $entityType === 'entrepreneur' ? 'Выписка ЕГРИП с электронной подписью' : 'Выписка ЕГРЮЛ с электронной подписью',
        'https://egrul.nalog.ru/index.html',
        'official-service',
        'Формируется бесплатно в официальном сервисе ФНС.'
    ));
    dnepr_append_document($documents, dnepr_document(
        'sme-register',
        'Выписка из реестра МСП',
        $smePdfUrl,
        'direct-pdf',
        'Прямая PDF-выписка, если ссылка присутствует в ответе ФНС.'
    ));
    dnepr_append_document($documents, dnepr_document(
        'accounting',
        'Бухгалтерская отчётность',
        $boUrl,
        'official-card',
        'Карточка организации в государственном ресурсе бухгалтерской отчётности.'
    ));
    dnepr_append_document($documents, dnepr_document(
        'charter-copies',
        'Учредительные документы',
        $charterUrl,
        'authorized-service',
        'Копии документов доступны через официальный сервис; может потребоваться ЕСИА.'
    ));
    dnepr_append_document($documents, dnepr_document(
        'registration-filings',
        'Представленные регистрационные документы',
        $registrationUrl,
        'official-service',
        'Сведения о документах, представленных для государственной регистрации.'
    ));

    $companies[] = array(
        'entityType' => $entityType,
        'shortName' => dnepr_row_value($row, array('namec', 'fio', 'namep')),
        'fullName' => dnepr_row_value($row, array('namep', 'fio', 'namec')),
        'status' => dnepr_row_value($row, array('sulst_name_ex', 'sipst_name_ex', 'statusname')),
        'inn' => dnepr_row_value($row, array('inn')),
        'ogrn' => dnepr_row_value($row, array('ogrn', 'ogrnip')),
        'registeredAt' => dnepr_row_value($row, array('dtreg', 'dtogrnip', 'dtogrn')),
        'ogrnAssignedAt' => dnepr_row_value($row, array('dtogrn', 'dtogrnip')),
        'region' => dnepr_row_value($row, array('regionname')),
        'okved' => dnepr_row_value($row, array('okved2main', 'okved2')),
        'okvedName' => dnepr_row_value($row, array('okved2mainname', 'okved2name')),
        'reportingYear' => dnepr_row_value($row, array('yearcode')),
        'reportingPeriod' => dnepr_row_value($row, array('periodcode')),
        'organizationFormCode' => dnepr_row_value($row, array('okopf12')),
        'statusCode' => dnepr_row_value($row, array('sulst_ex', 'sipst_ex')),
        'liquidationFlag' => dnepr_row_value($row, array('pr_liq')),
        'invalidFlag' => dnepr_row_value($row, array('invalid')),
        'preExistingFlag' => dnepr_row_value($row, array('predo')),
        'mainOkvedSource' => dnepr_row_value($row, array('okved2maintype')),
        'officialFields' => dnepr_official_fields($row),
        'documents' => $documents
    );
}

$payload = array(
    'ok' => true,
    'found' => count($companies) > 0,
    'query' => $query,
    'total' => (isset($result['ul']['rowCount']) ? (int) $result['ul']['rowCount'] : count($legalRows))
        + (isset($result['ip']['rowCount']) ? (int) $result['ip']['rowCount'] : count($entrepreneurRows)),
    'counts' => array(
        'legalEntities' => isset($result['ul']['rowCount']) ? (int) $result['ul']['rowCount'] : count($legalRows),
        'entrepreneurs' => isset($result['ip']['rowCount']) ? (int) $result['ip']['rowCount'] : count($entrepreneurRows),
        'returned' => count($companies)
    ),
    'companies' => $companies,
    'responseSections' => dnepr_response_sections($result),
    'source' => array(
        'name' => 'ФНС России · Прозрачный бизнес',
        'url' => 'https://pb.nalog.ru/',
        'retrievedAt' => gmdate('c'),
        'cached' => false,
        'diagnosticId' => $diagnosticId
    ),
    'disclaimer' => 'Ответ получен из официального открытого сервиса ФНС. Для юридически значимого решения сформируйте подписанную выписку ЕГРЮЛ или ЕГРИП.'
);
dnepr_source_log('fns', $query, count($companies) > 0 ? 'found' : 'missing', $diagnosticId, array('result_count' => count($companies), 'http_status' => 200, 'results' => $companies));
dnepr_cache_write($query, $payload);
dnepr_respond(200, $payload);
