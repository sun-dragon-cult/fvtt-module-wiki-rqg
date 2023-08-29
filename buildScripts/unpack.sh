#!/usr/bin/env sh

# Default values
inputDirectory='/Users/akew/Code/playground/foundryvtt/foundry-11/foundrydata/Data/systems/rqg/packs'

BOLD=$(tput bold)
RED=$(tput setaf 1)
NORMAL=$(tput sgr0)

die() { printf "%s \n" >&2 "${RED}$*${NORMAL}"; usage; exit 2; }  # complain to STDERR and exit with error
#die() { printf "${RED}$*" >&2; usage "$@"; exit 2; }  # complain to STDERR and exit with error
needs_arg() { if [ -z "$OPTARG" ]; then die "No arg for -$OPT option"; fi; }

usage() {
  printf "Extract Foundry classic level db content using https://github.com/foundryvtt/foundryvtt-cli\n"
  printf "Syntax: %s [options] ...compendium_packnames\n\n" "${BOLD}${0}${NORMAL}"

  printf "%soptions%s\n" "${BOLD}" "${NORMAL}"
  printf "%s-i%s	inputDirectory, current value [%s]\n" "${BOLD}" "${NORMAL}" "${BOLD}${inputDirectory}${NORMAL}"
  printf "%s-o%s	outputDirectory\n" "${BOLD}" "${NORMAL}"
  printf "%s-h%s	display this help\n" "${BOLD}" "${NORMAL}"
}

main() {
  for p in "$@"; do
    fvtt package --yaml unpack "${p}" --inputDirectory "${inputDirectory}" --outputDurectory "${outputDirectory}"
    printf "\n"
  done
  exit 0
}

while getopts hi:o: OPT; do
    case "${OPT}" in
      h )  usage "$@"; exit 0;;
		  i )  inputDirectory=${OPTARG};;
      o )  outputDirectory=${OPTARG};;
      * )  die ;;  # bad long option
    esac
done
shift $((OPTIND-1)) # remove parsed options and args from $@ list
if [ -z "$*" ]; then die "No packages to unpack"; fi;

main "$@"


