export { updateLocalList, removeFromLocalList } from "./owr-list";

export const updateListsFolder = (lists) => {
  const folderIndexes = {};
  let latestFolderIndex = null;

  lists.forEach((folder, index) => {
    if (folder.type === "folder") {
      folderIndexes[index] = folder.id;
    }
  });

  return lists.map((list, index) => {
    if (folderIndexes[index]) {
      latestFolderIndex = index;
    }

    if (list.type === "folder") {
      return list;
    }

    if (list.folder !== undefined) {
      return list;
    }

    const folder =
      latestFolderIndex !== null ? folderIndexes[latestFolderIndex] : null;

    return { ...list, folder };
  });
};
