#!/bin/sh
set -eu

DEPLOY_REPOSITORY="${HOME}/dimasites-deploy"
PUBLIC_DIRECTORY="${HOME}/public_html"
DEPLOY_LOCK="${HOME}/.dimasites-deploy-lock"
MANAGED_MARKER="${PUBLIC_DIRECTORY}/.dimasites-managed"
DEPLOY_ID="$(date +%Y%m%d-%H%M%S)-$$"
ROLLBACK_DIRECTORY="${HOME}/.dimasites-rollback-${DEPLOY_ID}"
DEPLOY_STARTED=0
DEPLOY_SUCCEEDED=0

if ! mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
    echo "Another deployment is already running."
    exit 0
fi

cleanup_lock() {
    rmdir "${DEPLOY_LOCK}" 2>/dev/null || true
}

cleanup_deploy() {
    if [ "${DEPLOY_STARTED}" -eq 1 ] && [ "${DEPLOY_SUCCEEDED}" -ne 1 ] && [ -d "${ROLLBACK_DIRECTORY}" ]; then
        echo "Deployment failed. Restoring the previous live version..."
        rsync -a --delete "${ROLLBACK_DIRECTORY}/" "${PUBLIC_DIRECTORY}/" || true
        echo "Previous live version restored."
    fi
    if [ -d "${ROLLBACK_DIRECTORY}" ]; then
        case "${ROLLBACK_DIRECTORY}" in
            "${HOME}"/.dimasites-rollback-*) find "${ROLLBACK_DIRECTORY}" -depth -delete 2>/dev/null || true ;;
        esac
    fi
    cleanup_lock
}
trap cleanup_deploy EXIT
trap 'exit 1' HUP INT TERM

if [ ! -d "${DEPLOY_REPOSITORY}/.git" ]; then
    echo "Repository is missing: ${DEPLOY_REPOSITORY}"
    echo "Clone it before running this script."
    exit 1
fi

FETCH_OK=0
FETCH_ATTEMPT=1
while [ "${FETCH_ATTEMPT}" -le 3 ]; do
    echo "GitHub update attempt ${FETCH_ATTEMPT}/3..."
    if timeout 75 git -C "${DEPLOY_REPOSITORY}" fetch --depth 1 origin main; then
        FETCH_OK=1
        break
    fi
    FETCH_ATTEMPT=$((FETCH_ATTEMPT + 1))
    [ "${FETCH_ATTEMPT}" -le 3 ] && sleep 10
done

if [ "${FETCH_OK}" -eq 1 ]; then
    git -C "${DEPLOY_REPOSITORY}" reset --hard FETCH_HEAD
elif [ -f "${MANAGED_MARKER}" ]; then
    echo "GitHub is temporarily unavailable. The current live version is unchanged."
    exit 0
else
    echo "GitHub is temporarily unavailable. Using the successfully cloned version for the first deployment."
fi

python3 "${DEPLOY_REPOSITORY}/scripts/check_site.py"

if ! command -v php >/dev/null 2>&1; then
    echo "Release gate failed: PHP CLI is not available. The live site is unchanged."
    exit 1
fi

if ! php -r 'exit(function_exists("curl_init") && class_exists("DOMDocument") ? 0 : 1);'; then
    echo "Release gate failed: PHP CLI needs curl and DOM extensions. The live site is unchanged."
    exit 1
fi

printf '%s\n' "$(git -C "${DEPLOY_REPOSITORY}" rev-parse HEAD)" > "${DEPLOY_REPOSITORY}/site/.deploy-version"

echo "Testing candidate against real FNS, EGRZ and EIS records..."
if ! python3 "${DEPLOY_REPOSITORY}/scripts/production_smoke.py" \
    --document-root "${DEPLOY_REPOSITORY}/site" \
    --php-bin "$(command -v php)" \
    --expected-version "$(git -C "${DEPLOY_REPOSITORY}" rev-parse HEAD)" \
    --report-json "${HOME}/dnepr-source-gate-latest.json"; then
    php "${DEPLOY_REPOSITORY}/scripts/source_runtime_probe.php" \
        > "${HOME}/dnepr-source-probe-latest.json" 2>&1 || true
    echo "Release gate rejected the candidate. The live site is unchanged."
    echo "Full source report: ${HOME}/dnepr-source-gate-latest.json"
    echo "Network/TLS probe: ${HOME}/dnepr-source-probe-latest.json"
    exit 1
fi

mkdir -p "${PUBLIC_DIRECTORY}"
if [ ! -f "${MANAGED_MARKER}" ]; then
    BACKUP_ARCHIVE="${HOME}/stroydnepr-before-git-$(date +%Y%m%d-%H%M%S).tar.gz"
    tar -czf "${BACKUP_ARCHIVE}" -C "${PUBLIC_DIRECTORY}" .
    echo "Initial backup created: ${BACKUP_ARCHIVE}"
fi

mkdir -p "${ROLLBACK_DIRECTORY}"
rsync -a "${PUBLIC_DIRECTORY}/" "${ROLLBACK_DIRECTORY}/"
DEPLOY_STARTED=1

rsync -a --delete --exclude='.well-known/' --exclude='admin/.access.php' \
    "${DEPLOY_REPOSITORY}/site/" "${PUBLIC_DIRECTORY}/"

git -C "${DEPLOY_REPOSITORY}" rev-parse HEAD > "${PUBLIC_DIRECTORY}/.deploy-version"
touch "${MANAGED_MARKER}"

echo "Verifying the published release marker..."
python3 "${DEPLOY_REPOSITORY}/scripts/production_smoke.py" \
    --base-url "https://stroydnepr.ru" \
    --expected-version "$(git -C "${DEPLOY_REPOSITORY}" rev-parse HEAD)" \
    --release-only --attempts 1

DEPLOY_SUCCEEDED=1
echo "Stroydnepr.ru deployed successfully after real source checks."
