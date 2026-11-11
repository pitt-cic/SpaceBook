#!/usr/bin/env bash
set -euo pipefail

#
# deploy-infra.sh - Deploy CDK infrastructure to AWS
#
# Usage: npm run deploy [options]
#
# Options:
#   --stage-name NAME         Deploy stage: dev, beta, or prod (default: beta)
#   --dev-name NAME           Developer name — required for dev/beta stages
#   --ses-sender-email EMAIL  SES-verified From address (prompted for on a new stack)
#   --skip-bootstrap          Skip the CDK bootstrap step
#   --require-approval LEVEL  Approval level for CDK deploy (never/any-change/broadening)
#   --help                    Show this help message
#

# Configuration
DEFAULT_APPROVAL="broadening"
DEFAULT_STAGE_NAME="${STAGE_NAME:-beta}"
KNOWN_STAGES=("dev" "beta" "prod")

# Color output helpers
print_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

print_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

print_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1"
}

print_warning() {
    echo -e "\033[0;33m[WARNING]\033[0m $1"
}

# Show help message
show_help() {
    cat << 'EOF'
Usage: npm run deploy [-- options]

Deploys the CDK infrastructure to AWS.

Steps performed:
  1. Check prerequisites (node, npm, aws cli, credentials)
  2. Resolve the SES sender email (asks for it on a new stack)
  3. Install npm dependencies
  4. Build TypeScript
  5. Run CDK bootstrap (unless --skip-bootstrap)
  6. Run CDK deploy

Options:
  --stage-name NAME         Deploy stage: dev, beta, or prod (default: beta)
  --dev-name NAME           Developer name — required for dev/beta stages
  --ses-sender-email EMAIL  From address for sign-in codes and notifications. Must be
                            verified in SES. If omitted: SES_SENDER_EMAIL (shell or
                            infra/.env), then the existing stack's value, then a prompt
  --skip-bootstrap          Skip the CDK bootstrap step (for subsequent deploys)
  --require-approval LEVEL  Approval level for CDK deploy (default: broadening)
                            Values: never, any-change, broadening
  --help                    Show this help message

Examples:
  npm run deploy -- --stage-name dev --dev-name alice    # Deploy alice's dev stack
  npm run deploy -- --stage-name beta --dev-name alice   # Deploy alice's beta stack
  npm run deploy -- --stage-name prod                    # Deploy the prod stack
  npm run deploy -- --stage-name dev --dev-name alice --ses-sender-email spacebook@example.edu
  npm run deploy -- --stage-name dev --dev-name alice --skip-bootstrap
  npm run deploy -- --stage-name dev --dev-name alice --require-approval never
EOF
    exit 0
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed."
        echo "  Please install Node.js from https://nodejs.org/"
        echo "  Or use a version manager like nvm: https://github.com/nvm-sh/nvm"
        exit 1
    fi
    local node_version
    node_version=$(node --version)
    print_success "Node.js found: $node_version"

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed."
        echo "  npm should be included with Node.js. Please reinstall Node.js."
        exit 1
    fi
    local npm_version
    npm_version=$(npm --version)
    print_success "npm found: v$npm_version"

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed."
        echo "  Install from: https://aws.amazon.com/cli/"
        exit 1
    fi
    local aws_version
    aws_version=$(aws --version 2>&1 | cut -d' ' -f1)
    print_success "AWS CLI found: $aws_version"

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials are not configured or are invalid."
        echo ""
        echo "  Please configure your AWS credentials:"
        echo "    aws configure"
        echo ""
        echo "  Or set environment variables:"
        echo "    export AWS_ACCESS_KEY_ID=your_key"
        echo "    export AWS_SECRET_ACCESS_KEY=your_secret"
        echo "    export AWS_REGION=us-east-1"
        echo ""
        exit 1
    fi

    local caller_identity
    caller_identity=$(aws sts get-caller-identity --query 'Account' --output text)
    print_success "AWS credentials configured (Account: $caller_identity)"
}

# Install dependencies
install_dependencies() {
    print_info "Installing npm dependencies..."
    npm install
    print_success "Dependencies installed"
}

# Build TypeScript
build_package() {
    print_info "Building TypeScript..."
    npm run build
    print_success "TypeScript compiled successfully"
}

# Bootstrap CDK
bootstrap_cdk() {
    print_info "Bootstrapping CDK..."
    npx cdk bootstrap
    print_success "CDK bootstrap complete"
}

# CDK context args for the chosen stage — bin/app.ts requires stageName, and
# devName for every non-prod stage.
cdk_context_args() {
    local stage_name="$1"
    local dev_name="$2"
    if [[ -n "$dev_name" ]]; then
        echo "-c stageName=$stage_name -c devName=$dev_name"
    else
        echo "-c stageName=$stage_name"
    fi
}

# Deploy-time settings (SES sender, calendar invites — see .env.example),
# exported so bin/app.ts and infra-stack.ts read them from process.env.
load_env_file() {
    local env_file
    env_file="$(dirname "$0")/.env"
    if [[ -f "$env_file" ]]; then
        print_info "Loading settings from $env_file"
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
    fi
}

is_valid_email() {
    [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]
}

# The SES From address for sign-in codes and notification emails. There is no
# default: it must be an identity verified in SES in this account/region.
# Order: --ses-sender-email, SES_SENDER_EMAIL (shell or infra/.env), the
# existing stack's SesSenderEmail output, then an interactive prompt (so a new
# stack always asks). Sets SES_SENDER_EMAIL_RESOLVED.
resolve_ses_sender_email() {
    local stack_name="$1"
    local email="$2"

    if [[ -z "$email" ]]; then
        email="${SES_SENDER_EMAIL:-}"
    fi
    if [[ -z "$email" ]]; then
        email=$(aws cloudformation describe-stacks --stack-name "$stack_name" \
            --query "Stacks[0].Outputs[?OutputKey=='SesSenderEmail'].OutputValue" \
            --output text 2>/dev/null || true)
        if [[ "$email" == "None" ]]; then
            email=""
        fi
        if [[ -n "$email" ]]; then
            print_info "Using $stack_name's existing SES sender email"
        fi
    fi
    if [[ -z "$email" ]]; then
        if [[ ! -t 0 ]]; then
            print_error "No SES sender email for $stack_name."
            echo "  Pass --ses-sender-email EMAIL or set SES_SENDER_EMAIL in infra/.env."
            exit 1
        fi
        echo ""
        print_info "$stack_name needs an SES sender email: the From address for sign-in codes and notifications."
        echo "  It must be verified in Amazon SES (this account and region) for email to send."
        while true; do
            read -r -p "  SES sender email: " email
            if is_valid_email "$email"; then
                break
            fi
            print_warning "That doesn't look like an email address. Try again."
        done
    fi
    if ! is_valid_email "$email"; then
        print_error "Invalid SES sender email: $email"
        exit 1
    fi
    SES_SENDER_EMAIL_RESOLVED="$email"
    print_success "SES sender email: $email"
}

# Warn (don't fail) if neither the address nor its domain is verified in SES:
# the deploy works, but OTP codes and notifications won't send until it is.
check_ses_identity() {
    local email="$1"
    local domain="${email#*@}"
    local status
    status=$(aws ses get-identity-verification-attributes --identities "$email" "$domain" \
        --query "VerificationAttributes.*.VerificationStatus" --output text 2>/dev/null || true)
    if [[ "$status" != *Success* ]]; then
        print_warning "$email (or $domain) isn't verified in SES in this region yet."
        echo "  Verify it with: aws ses verify-email-identity --email-address $email"
        echo "  Until then, sign-in codes and notification emails will fail to send."
    fi
}

# Deploy CDK
deploy_cdk() {
    local context_args="$1"
    local approval_level="$2"
    print_info "Deploying CDK stack (require-approval: $approval_level)..."
    # shellcheck disable=SC2086 # context_args is intentionally word-split
    npx cdk deploy $context_args --require-approval "$approval_level"
    print_success "CDK deployment complete"
}

# Main function
main() {
    local stage_name="$DEFAULT_STAGE_NAME"
    local dev_name=""
    local ses_sender_email=""
    local skip_bootstrap=false
    local require_approval="$DEFAULT_APPROVAL"
    local stack_name

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --stage-name)
                if [[ -n "${2:-}" ]]; then
                    stage_name="$2"
                    shift 2
                else
                    print_error "--stage-name requires a value (dev, beta, or prod)"
                    exit 1
                fi
                ;;
            --dev-name)
                if [[ -n "${2:-}" ]]; then
                    dev_name="$2"
                    shift 2
                else
                    print_error "--dev-name requires a value"
                    exit 1
                fi
                ;;
            --ses-sender-email)
                if [[ -n "${2:-}" ]]; then
                    ses_sender_email="$2"
                    shift 2
                else
                    print_error "--ses-sender-email requires a value"
                    exit 1
                fi
                ;;
            --skip-bootstrap)
                skip_bootstrap=true
                shift
                ;;
            --require-approval)
                if [[ -n "${2:-}" ]]; then
                    case "$2" in
                        never|any-change|broadening)
                            require_approval="$2"
                            shift 2
                            ;;
                        *)
                            print_error "Invalid approval level: $2"
                            echo "  Valid values: never, any-change, broadening"
                            exit 1
                            ;;
                    esac
                else
                    print_error "--require-approval requires a level (never/any-change/broadening)"
                    exit 1
                fi
                ;;
            --help|-h)
                show_help
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information."
                exit 1
                ;;
        esac
    done

    if [[ ! " ${KNOWN_STAGES[*]} " =~ " $stage_name " ]]; then
        print_error "Unknown stage '$stage_name' — expected one of: ${KNOWN_STAGES[*]}"
        exit 1
    fi
    if [[ "$stage_name" == "prod" ]]; then
        # bin/app.ts names prod's stack/resources without a developer suffix.
        dev_name=""
        stack_name="SpaceBook-stack-prod"
    elif [[ -z "$dev_name" ]]; then
        print_error "--dev-name is required for non-prod stages"
        echo "  Example: --stage-name $stage_name --dev-name yourname"
        exit 1
    else
        stack_name="SpaceBook-stack-${dev_name}-${stage_name}"
    fi
    local context_args
    context_args=$(cdk_context_args "$stage_name" "$dev_name")

    echo ""
    echo "=================================="
    echo "  CDK Infrastructure Deployment (stack: $stack_name)"
    echo "=================================="
    echo ""

    # Check prerequisites
    check_prerequisites
    echo ""

    # Resolve the SES sender before the slow steps, so a new stack asks up front
    load_env_file
    resolve_ses_sender_email "$stack_name" "$ses_sender_email"
    check_ses_identity "$SES_SENDER_EMAIL_RESOLVED"
    context_args="$context_args -c sesSenderEmail=$SES_SENDER_EMAIL_RESOLVED"
    echo ""

    # Install dependencies
    install_dependencies
    echo ""

    # Build TypeScript
    build_package
    echo ""

    # Bootstrap CDK (unless skipped)
    if [[ "$skip_bootstrap" == false ]]; then
        bootstrap_cdk
        echo ""
    else
        print_info "Skipping CDK bootstrap (--skip-bootstrap flag)"
        echo ""
    fi

    # Deploy CDK
    deploy_cdk "$context_args" "$require_approval"
    echo ""

    # Final success message
    echo "=================================="
    print_success "Infrastructure deployment complete!"
    echo "=================================="
    echo ""
    echo "Next steps:"
    echo "  - View your resources in the AWS Console"
    echo "  - Run 'npx cdk diff $context_args' to see pending changes"
    echo "  - Run 'npx cdk destroy $context_args' to tear down the stack"
    echo "  - Run 'npm run setup-dev -- --stage-name $stage_name${dev_name:+ --dev-name $dev_name}' in frontend/ to refresh .env"
    echo ""
}

# Run main
main "$@"
