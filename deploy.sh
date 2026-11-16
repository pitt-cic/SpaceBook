#!/usr/bin/env bash
set -euo pipefail

#
# deploy.sh - Full-stack deployment: infrastructure + frontend
#
# Deploys the CDK infrastructure, then builds the React frontend locally and
# uploads it to Amplify as a zip. Safe for a first-time (from-scratch) AWS
# deployment. Wraps infra/deploy-infra.sh and frontend/deploy-frontend.sh, which
# can still be run on their own.
#
# Defaults:
#   - If neither --dev nor --stage is given, deploys to PRODUCTION
#     and prompts for confirmation.
#   - If --dev is given without --stage, the stage defaults to 'dev'.
#   - CDK approval level defaults to 'broadening'.
#   - Amplify branch defaults to 'main'.
#
# Usage: ./deploy.sh [options]   (see --help)
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_APPROVAL="broadening"
DEFAULT_BRANCH="main"
KNOWN_STAGES=("dev" "beta" "prod")
AMPLIFY_URL=""

print_info()    { echo -e "\033[0;34m[INFO]\033[0m $1"; }
print_success() { echo -e "\033[0;32m[SUCCESS]\033[0m $1"; }
print_error()   { echo -e "\033[0;31m[ERROR]\033[0m $1"; }
print_warning() { echo -e "\033[0;33m[WARNING]\033[0m $1"; }
print_step()    { echo ""; echo -e "\033[1;36m━━━ $1 ━━━\033[0m"; echo ""; }

show_help() {
    cat << 'EOF'
Usage: ./deploy.sh [options]

Full-stack deployment: deploys AWS infrastructure via CDK, then builds
the React frontend locally and uploads it to Amplify via zip.

If neither --dev nor --stage is provided, defaults to a PRODUCTION deployment
and prompts for confirmation.

Steps:
  1. Check prerequisites (node, npm, aws cli, zip, curl, pip3 or docker)
  2. Confirm deployment target (warns if defaulting to production)
  3. Confirm AWS identity
  4. Deploy CDK infrastructure (asks for the SES sender email on a new stack)
  5. Build and upload frontend to Amplify

Options:
  --dev NAME                Developer name (required for dev/beta stages)
  --stage STAGE             Deployment stage: dev, beta, prod
                            (default: prod, or dev when --dev is given)
  --profile NAME            AWS CLI profile name (optional)
  --ses-sender-email EMAIL  SES-verified From address for sign-in codes and
                            notifications. If omitted: SES_SENDER_EMAIL (shell or
                            infra/.env), then the existing stack's value, then a prompt
  --branch NAME             Amplify branch to deploy (default: main)
  --skip-bootstrap          Skip CDK bootstrap (use after first deploy)
  --require-approval LEVEL  CDK approval level (default: broadening, or never
                            with --yes). Values: never, any-change, broadening
  --skip-build              Skip frontend build, deploy existing frontend/dist/
  --no-wait                 Don't wait for the Amplify deployment to finish
  --infra-only              Deploy infrastructure only, skip frontend
  --frontend-only           Deploy frontend only (infra must already exist)
  --yes / -y                Skip all confirmation prompts (including CDK's
                            IAM-change approval unless --require-approval is set)
  --help                    Show this help message

Examples:
  ./deploy.sh                                             # Production deploy (prompts)
  ./deploy.sh --yes --ses-sender-email spacebook@pitt.edu # Production deploy, no prompts
  ./deploy.sh --dev alice --profile myprofile             # alice's dev stack
  ./deploy.sh --dev alice --stage beta                    # alice's beta stack
  ./deploy.sh --infra-only --dev alice                    # Infrastructure only
  ./deploy.sh --frontend-only --yes                       # Prod frontend only, no prompts
  ./deploy.sh --skip-bootstrap --require-approval never   # Fast re-deploy
EOF
    exit 0
}

# ── Prerequisites ──────────────────────────────────────────────────────────────

check_prerequisites() {
    local frontend_only="$1"
    print_info "Checking prerequisites..."
    local missing=0

    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed."
        echo "  Install from: https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm"
        missing=1
    else
        print_success "Node.js found: $(node --version)"
    fi

    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed (should ship with Node.js)."
        missing=1
    else
        print_success "npm found: v$(npm --version)"
    fi

    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed."
        echo "  Install from: https://aws.amazon.com/cli/"
        missing=1
    else
        print_success "AWS CLI found: $(aws --version 2>&1 | cut -d' ' -f1)"
    fi

    # Lambda bundling tries a local `pip3 install` first and falls back to
    # Docker, so either one is enough (see infra/lib/lambda-utils.ts).
    if [[ "$frontend_only" == false ]]; then
        if command -v pip3 &> /dev/null; then
            print_success "pip3 found: $(pip3 --version | cut -d' ' -f2) (used to bundle Python Lambdas)"
        elif command -v docker &> /dev/null && docker info &> /dev/null; then
            print_success "Docker found and running (used to bundle Python Lambdas)"
        else
            print_error "Neither pip3 nor a running Docker daemon was found."
            echo "  One is needed to bundle the Python Lambda functions."
            echo "  Install Python 3.13 (includes pip3): https://www.python.org/downloads/"
            echo "  or Docker: https://docs.docker.com/get-docker/"
            missing=1
        fi
    fi

    if ! command -v zip &> /dev/null; then
        print_error "zip is not installed."
        echo "  macOS:   brew install zip"
        echo "  Linux:   sudo apt install zip"
        echo "  Windows: choco install zip  (via Chocolatey, https://chocolatey.org)"
        missing=1
    else
        print_success "zip found"
    fi

    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed."
        missing=1
    else
        print_success "curl found"
    fi

    if command -v aws &> /dev/null; then
        if ! aws sts get-caller-identity &> /dev/null; then
            print_error "AWS credentials are not configured or are invalid."
            echo ""
            echo "  Configure credentials with one of:"
            echo "    aws configure"
            echo "    export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=..."
            echo "    aws sso login --profile <profile>"
            missing=1
        else
            local account
            account=$(aws sts get-caller-identity --query 'Account' --output text)
            print_success "AWS credentials valid (Account: $account)"
        fi
    fi

    if [[ "$missing" -ne 0 ]]; then
        echo ""
        print_error "One or more prerequisites are missing. Fix the above and re-run."
        exit 1
    fi
}

# ── Confirmation helpers ───────────────────────────────────────────────────────

confirm_production_default() {
    local skip_confirm="$1"
    echo ""
    print_warning "No --dev or --stage specified — defaulting to PRODUCTION deployment."
    echo ""

    if [[ "$skip_confirm" == true ]]; then
        print_warning "Proceeding with production deploy (--yes flag set)."
        return 0
    fi

    read -r -p "This will deploy to PRODUCTION. Continue? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_info "Aborted by user."
        exit 0
    fi
}

aws_region() {
    local region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
    [[ -z "$region" ]] && region=$(aws configure get region 2>/dev/null || true)
    echo "${region:-us-east-1}"
}

confirm_aws_identity() {
    local skip_confirm="$1"
    echo ""
    echo "=================================================="
    echo "  AWS Identity"
    echo "=================================================="

    local account arn
    account=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null)
    arn=$(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null)

    echo "  Profile: ${AWS_PROFILE:-(default)}"
    echo "  Account: $account"
    echo "  ARN:     $arn"
    echo "  Region:  $(aws_region)"
    echo "=================================================="
    echo ""

    if [[ "$skip_confirm" == true ]]; then
        print_info "Skipping confirmation (--yes)"
        return 0
    fi

    read -r -p "Proceed with this AWS identity? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_info "Aborted by user."
        exit 0
    fi
}

# ── Deployment steps ───────────────────────────────────────────────────────────

# infra/deploy-infra.sh installs dependencies, builds TypeScript, resolves the
# SES sender email (prompting on a new stack), bootstraps, and deploys.
deploy_infra() {
    local stage_name="$1"
    local dev_name="$2"
    local skip_bootstrap="$3"
    local require_approval="$4"
    local ses_sender_email="$5"

    local args=(--stage-name "$stage_name" --require-approval "$require_approval")
    [[ -n "$dev_name" ]] && args+=(--dev-name "$dev_name")
    [[ -n "$ses_sender_email" ]] && args+=(--ses-sender-email "$ses_sender_email")
    [[ "$skip_bootstrap" == true ]] && args+=(--skip-bootstrap)

    (cd "$SCRIPT_DIR/infra" && bash ./deploy-infra.sh "${args[@]}")
}

# frontend/deploy-frontend.sh reads the stack outputs, builds with them,
# checks the bundle matches the stack, then zips and uploads to Amplify.
deploy_frontend() {
    local stage_name="$1"
    local dev_name="$2"
    local stack_name="$3"
    local branch_name="$4"
    local no_wait="$5"
    local skip_build="$6"

    # Amplify branch names can't contain slashes
    local safe_branch="${branch_name//\//-}"

    local args=(--stage-name "$stage_name" --branch "$safe_branch")
    [[ -n "$dev_name" ]] && args+=(--dev-name "$dev_name")
    [[ "$no_wait" == true ]] && args+=(--no-wait)
    [[ "$skip_build" == true ]] && args+=(--skip-build)

    if [[ "$skip_build" == false ]]; then
        print_info "Installing frontend dependencies..."
        (cd "$SCRIPT_DIR/frontend" && npm install)
        print_success "Dependencies installed"
        echo ""
    fi

    (cd "$SCRIPT_DIR/frontend" && bash ./deploy-frontend.sh "${args[@]}")

    local app_id domain
    app_id=$(aws cloudformation describe-stacks --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='AmplifyAppId'].OutputValue" \
        --output text 2>/dev/null || true)
    if [[ -n "$app_id" && "$app_id" != "None" ]]; then
        domain=$(aws amplify get-app --app-id "$app_id" \
            --query 'app.defaultDomain' --output text 2>/dev/null || true)
        [[ -n "$domain" && "$domain" != "None" ]] && AMPLIFY_URL="https://${safe_branch}.${domain}"
    fi
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
    local dev_name=""
    local stage_name=""
    local profile_name=""
    local ses_sender_email=""
    local branch_name="$DEFAULT_BRANCH"
    local skip_bootstrap=false
    local require_approval=""
    local skip_build=false
    local no_wait=false
    local infra_only=false
    local frontend_only=false
    local skip_confirm=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dev)
                [[ -z "${2:-}" ]] && { print_error "--dev requires a value"; exit 1; }
                dev_name="$2"; shift 2 ;;
            --stage)
                [[ -z "${2:-}" ]] && { print_error "--stage requires a value"; exit 1; }
                stage_name="$2"; shift 2 ;;
            --profile)
                [[ -z "${2:-}" ]] && { print_error "--profile requires a value"; exit 1; }
                profile_name="$2"; shift 2 ;;
            --ses-sender-email)
                [[ -z "${2:-}" ]] && { print_error "--ses-sender-email requires a value"; exit 1; }
                ses_sender_email="$2"; shift 2 ;;
            --branch)
                [[ -z "${2:-}" ]] && { print_error "--branch requires a value"; exit 1; }
                branch_name="$2"; shift 2 ;;
            --skip-bootstrap)
                skip_bootstrap=true; shift ;;
            --require-approval)
                case "${2:-}" in
                    never|any-change|broadening) require_approval="$2"; shift 2 ;;
                    *) print_error "--require-approval must be: never, any-change, broadening"; exit 1 ;;
                esac ;;
            --skip-build)
                skip_build=true; shift ;;
            --no-wait)
                no_wait=true; shift ;;
            --infra-only)
                infra_only=true; shift ;;
            --frontend-only)
                frontend_only=true; shift ;;
            --yes|-y)
                skip_confirm=true; shift ;;
            --help|-h)
                show_help ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information."
                exit 1 ;;
        esac
    done

    # --yes means no prompts at all, including CDK's IAM-change approval
    # (which otherwise fails without a TTY); an explicit --require-approval wins.
    if [[ -z "$require_approval" ]]; then
        if [[ "$skip_confirm" == true ]]; then
            require_approval="never"
        else
            require_approval="$DEFAULT_APPROVAL"
        fi
    fi

    if [[ "$infra_only" == true && "$frontend_only" == true ]]; then
        print_error "--infra-only and --frontend-only are mutually exclusive."
        exit 1
    fi

    # Default to prod when neither --dev nor --stage was provided; --dev alone means dev
    local defaulted_to_prod=false
    if [[ -z "$stage_name" ]]; then
        if [[ -n "$dev_name" ]]; then
            stage_name="dev"
        else
            stage_name="prod"
            defaulted_to_prod=true
        fi
    fi

    if [[ ! " ${KNOWN_STAGES[*]} " =~ " $stage_name " ]]; then
        print_error "Unknown stage '$stage_name' — expected one of: ${KNOWN_STAGES[*]}"
        exit 1
    fi

    if [[ "$stage_name" == "prod" ]]; then
        if [[ -n "$dev_name" ]]; then
            print_warning "--dev is ignored for the prod stage."
            dev_name=""
        fi
    elif [[ -z "$dev_name" ]]; then
        print_error "--dev is required for non-prod stages"
        echo "  Example: ./deploy.sh --dev yourname --stage $stage_name"
        exit 1
    fi

    [[ -n "$profile_name" ]] && export AWS_PROFILE="$profile_name"

    # Stack name must match infra/bin/app.ts
    local stack_name
    if [[ "$stage_name" == "prod" ]]; then
        stack_name="SpaceBook-stack-prod"
    else
        stack_name="SpaceBook-stack-${dev_name}-${stage_name}"
    fi

    local phases_display
    if [[ "$infra_only" == true ]]; then
        phases_display="infra only"
    elif [[ "$frontend_only" == true ]]; then
        phases_display="frontend only"
    else
        phases_display="infra → frontend"
    fi

    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║       SpaceBook Full-Stack Deployment        ║"
    echo "╠══════════════════════════════════════════════╣"
    printf  "║  Stack:      %-32s║\n" "$stack_name"
    printf  "║  Profile:    %-32s║\n" "${AWS_PROFILE:-(default)}"
    printf  "║  Branch:     %-32s║\n" "$branch_name"
    printf  "║  Approval:   %-32s║\n" "$require_approval"
    printf  "║  Phases:     %-32s║\n" "$phases_display"
    echo "╚══════════════════════════════════════════════╝"

    # ── Step 1: Prerequisites ─────────────────────────────────────────────────
    print_step "Step 1 — Prerequisites"
    check_prerequisites "$frontend_only"

    # ── Step 2: Production default warning ───────────────────────────────────
    if [[ "$defaulted_to_prod" == true ]]; then
        print_step "Step 2 — Deployment Target"
        confirm_production_default "$skip_confirm"
    fi

    # ── Step 3: AWS Identity ──────────────────────────────────────────────────
    print_step "Step 3 — AWS Identity"
    confirm_aws_identity "$skip_confirm"

    # ── Step 4: Infrastructure ────────────────────────────────────────────────
    if [[ "$frontend_only" == false ]]; then
        print_step "Step 4 — Infrastructure (CDK)"
        deploy_infra "$stage_name" "$dev_name" "$skip_bootstrap" "$require_approval" "$ses_sender_email"
        echo ""
        print_success "Infrastructure deployment complete."
    else
        print_step "Step 4 — Infrastructure (skipped)"
        print_info "Skipping infrastructure deploy (--frontend-only)"
    fi

    # ── Step 5: Frontend ──────────────────────────────────────────────────────
    if [[ "$infra_only" == false ]]; then
        print_step "Step 5 — Frontend (Amplify)"
        deploy_frontend "$stage_name" "$dev_name" "$stack_name" "$branch_name" "$no_wait" "$skip_build"
        echo ""
        print_success "Frontend deployment complete."
    else
        print_step "Step 5 — Frontend (skipped)"
        print_info "Skipping frontend deploy (--infra-only)"
    fi

    echo ""
    echo "╔══════════════════════════════════════════════╗"
    print_success "Full-stack deployment complete!"
    echo "╚══════════════════════════════════════════════╝"
    echo ""
    if [[ -n "${AMPLIFY_URL:-}" ]]; then
        echo "  App URL:     $AMPLIFY_URL"
        echo "  Staff login: $AMPLIFY_URL/login"
        echo ""
    fi
    echo "  Next: create the first admin in the staff Cognito pool"
    echo "  (see DEVELOPER_GUIDE.md#signing-in)."
    echo ""
}

main "$@"
